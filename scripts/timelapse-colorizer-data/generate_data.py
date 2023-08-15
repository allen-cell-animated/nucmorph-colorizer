from aicsimageio import AICSImage
from PIL import Image
import argparse
import json
import logging
import numpy as np
import os
import platform
import skimage
import time

from nuc_morph_analysis.utilities.create_base_directories import create_base_directories
from nuc_morph_analysis.preprocessing.load_data import (
    load_dataset,
    get_dataset_pixel_size,
)

# python timelapse-colorizer-data/generate_data.py --output_dir /allen/aics/animated-cell/Dan/fileserver/colorizer/data --dataset baby_bear
# python timelapse-colorizer-data/generate_data.py --output_dir /allen/aics/animated-cell/Dan/fileserver/colorizer/data --dataset mama_bear
# python timelapse-colorizer-data/generate_data.py --output_dir /allen/aics/animated-cell/Dan/fileserver/colorizer/data --dataset goldilocks

# DATASET SPEC:
# manifest.json:
#   frames: [frame_0.png, frame_1.png, ...]
#   features: { feature_0: feature_0.json, feature_1: feature_1.json, ... }
#   outliers: [ bool, bool, ... ] // per cell, same order as featureN.json files
#   tracks: "tracks.json" // per-cell track id, same format as featureN.json files
#   times: "times.json" // per-cell frame index, same format as featureN.json files
#   centroids: "centroids.json"  // per-cell centroid. For each index i, the
#       coordinates are (x: data[2i], y: data[2i + 1]).
#   bounds: "bounds.json"  // bounding boxes for each cell. For each index i, the
#       minimum bounding box coordinates (upper left corner) are given by
#       (x: data[4i], y: data[4i + 1]), and the maximum bounding box coordinates
#       (lower right corner) are given by (x: data[4i + 2], y: data[4i + 3]).
#
# frame0.png:  numbers stored in RGB. true scalar index is (R + G*256 + B*256*256)
#
# feature0.json: { data: [1.2, 3.4, 5.6, ...], min: 1.2, max: 5.6 }
#   there should be one value for every cell in the whole movie.
#   the min and max should be the global min and max across the whole movie
#   NaN (outlier) values are not yet supported

# dataset	string	In FMS manifest	Name of which dataset this row of data belongs to (baby_bear, goldilocks, or mama_bear)
# track_id	int	In FMS manifest	ID for a single nucleus in all frames for which it exists (single value per nucleus, consistent across multiple frames)
# CellID	hash	In FMS manifest	ID for a single instance/frame of a nucleus (every nucleus has a different value in every frame)
# index_sequence	int	In FMS manifest	frame number associated with the nucleus data in a given row, relative to the start of the movie
# colony_time	int	Needs calculated and added	Frame number staggered by a given amount per dataset, so that the frame numbers in all datasets are temporally algined relative to one another rather than all starting at 0
# raw_full_zstack_path	String	In FMS manifest	Path to zstack of raw image of entire colony in a single frame
# seg_full_zstack_path	String	In FMS manifest	Path to zstack of segmentation of entire colony in a single frame
# is_outlier	boolean	In FMS manifest	True if this nucleus in this frame is flagged as an outlier (a single nucleus may be an outlier in some frames but not others)
# edge_cell	boolean	In FMS manifest	True if this nucleus touches the edge of the FOV
# NUC_shape_volume_lcc	float	In FMS manifest	Volume of a single nucleus in pixels in a given frame
# NUC_position_depth	float	In FMS manifest	Height (in the z-direction) of the a single nucleus in pixels in a given frame
# NUC_PC1	float	Needs calculated and added	Value for shape mode 1 for a single nucleus in a given frame
# NUC_PC2	float	Needs calculated and added	Value for shape mode 2 for a single nucleus in a given frame
# NUC_PC3	float	Needs calculated and added	Value for shape mode 3 for a single nucleus in a given frame
# NUC_PC4	float	Needs calculated and added	Value for shape mode 4 for a single nucleus in a given frame
# NUC_PC5	float	Needs calculated and added	Value for shape mode 5 for a single nucleus in a given frame
# NUC_PC6	float	Needs calculated and added	Value for shape mode 6 for a single nucleus in a given frame
# NUC_PC7	float	Needs calculated and added	Value for shape mode 7 for a single nucleus in a given frame
# NUC_PC8	float	Needs calculated and added	Value for shape mode 8 for a single nucleus in a given frame


def make_frames(grouped_frames, output_dir, dataset, scale: float):
    outpath = os.path.join(output_dir, dataset)

    lut_adjustment = 1
    nframes = len(grouped_frames)
    logging.info("Making {} frames...".format(nframes))
    # Get the highest index across all groups, and add +1 for zero-based indexing and the lut adjustment
    totalIndices = grouped_frames.initialIndex.max().max() + lut_adjustment + 1
    # Create an array, where for each segmentation index
    # we have 4 indices representing the bounds (2 sets of x,y coordinates).
    # ushort can represent up to 65_535. Images with a larger resolution than this will need to replace the datatype.
    bbox_data = np.zeros(shape=(totalIndices * 2 * 2), dtype=np.ushort)

    for group_name, frame in grouped_frames:
        # take first row to get zstack path
        row = frame.iloc[0]
        frame_number = row["index_sequence"]

        start_time = time.time()

        zstackpath = row["seg_full_zstack_path"]
        if platform.system() == "Windows":
            zstackpath = "/" + zstackpath
        zstack = AICSImage(zstackpath).get_image_data("ZYX", S=0, T=0, C=0)
        seg2d = zstack.max(axis=0)
        mx = np.nanmax(seg2d)
        mn = np.nanmin(seg2d[np.nonzero(seg2d)])
        # float comparison with 1 here is okay because this is not a calculated value
        if scale != 1.0:
            seg2d = skimage.transform.rescale(
                seg2d, scale, anti_aliasing=False, order=0
            )
        seg2d = seg2d.astype(np.uint32)

        lut = np.zeros((mx + 1), dtype=np.uint32)
        for row_index, row in frame.iterrows():
            # build our remapping LUT:
            label = int(row["label_img"])
            rowind = int(row["initialIndex"])
            lut[label] = rowind + lut_adjustment

        # remap indices of this frame.
        seg_remapped = lut[seg2d]

        # Capture bounding boxes
        # Optimize by skipping i = 0, since it's used as a null value in every frame
        for i in range(1, lut.size):
            # Boolean array that represents all pixels segmented with this index
            cell = np.argwhere(seg_remapped == lut[i])

            if cell.size > 0:
                write_index = lut[i] * 4
                # Reverse min and max so it is written in x, y order
                bbox_min = cell.min(0).tolist()
                bbox_max = cell.max(0).tolist()
                bbox_min.reverse()
                bbox_max.reverse()
                bbox_data[write_index : write_index + 2] = bbox_min
                bbox_data[write_index + 2 : write_index + 4] = bbox_max

        # convert data to RGBA
        seg_rgba = np.zeros(
            (seg_remapped.shape[0], seg_remapped.shape[1], 4), dtype=np.uint8
        )
        seg_rgba[:, :, 0] = (seg_remapped & 0x000000FF) >> 0
        seg_rgba[:, :, 1] = (seg_remapped & 0x0000FF00) >> 8
        seg_rgba[:, :, 2] = (seg_remapped & 0x00FF0000) >> 16
        seg_rgba[:, :, 3] = 255  # (seg2d & 0xFF000000) >> 24
        img = Image.fromarray(seg_rgba)  # new("RGBA", (xres, yres), seg2d)
        img.save(outpath + "/frame_" + str(frame_number) + ".png")

        time_elapsed = time.time() - start_time
        logging.info(
            "Frame {} finished in {:5.2f} seconds.".format(
                int(frame_number), time_elapsed
            )
        )

        # Save bounding box to JSON
        bbox_json = {"data": np.ravel(bbox_data).tolist()}  # flatten to 2D
        with open(outpath + "/bounds.json", "w") as f:
            json.dump(bbox_json, f)


def make_features(a, features, output_dir, dataset, scale: float):
    nfeatures = len(features)
    logging.info("Making features...")

    outpath = os.path.join(output_dir, dataset)

    # TODO check outlier and replace values with NaN or something!
    logging.info("Writing outliers.json...")
    outliers = a["is_outlier"].to_numpy()
    ojs = {"data": outliers.tolist(), "min": False, "max": True}
    with open(outpath + "/outliers.json", "w") as f:
        json.dump(ojs, f)

    # Note these must be in same order as features and same row order as the dataframe.
    logging.info("Writing track.json...")
    tracks = a["track_id"].to_numpy()
    trjs = {"data": tracks.tolist()}
    with open(outpath + "/tracks.json", "w") as f:
        json.dump(trjs, f)

    logging.info("Writing times.json...")
    times = a["index_sequence"].to_numpy()
    tijs = {"data": times.tolist()}
    with open(outpath + "/times.json", "w") as f:
        json.dump(tijs, f)

    logging.info("Writing centroids.json...")
    centroids_x = a["centroid_x"].to_numpy()
    centroids_y = a["centroid_y"].to_numpy()
    centroids_stacked = np.ravel(np.dstack([centroids_x, centroids_y]))
    centroids_stacked = centroids_stacked * scale
    centroids_stacked = centroids_stacked.astype(int)

    centroids_json = {"data": centroids_stacked.tolist()}
    with open(outpath + "/centroids.json", "w") as f:
        json.dump(centroids_json, f)

    logging.info("Writing feature json...")
    for i in range(nfeatures):
        f = a[features[i]].to_numpy()
        fmin = np.nanmin(f)
        fmax = np.nanmax(f)
        # TODO normalize output range excluding outliers?
        js = {"data": f.tolist(), "min": fmin, "max": fmax}
        with open(outpath + "/feature_" + str(i) + ".json", "w") as f:
            json.dump(js, f)
    logging.info("Done writing features.")


def make_dataset(output_dir="./data/", dataset="baby_bear", do_frames=True, scale=1):
    os.makedirs(os.path.join(output_dir, dataset), exist_ok=True)

    # use nucmorph to load data
    datadir, figdir = create_base_directories(dataset)
    pixsize = get_dataset_pixel_size(dataset)

    # a is the full dataset!
    a = load_dataset(dataset, datadir=None)
    logging.info("Loaded dataset '" + str(dataset) + "'.")

    columns = ["track_id", "index_sequence", "seg_full_zstack_path", "label_img"]
    # b is the reduced dataset
    b = a[columns]
    b = b.reset_index(drop=True)
    b["initialIndex"] = b.index.values

    grouped_frames = b.groupby("index_sequence")
    # get a single path from each time in the set.
    # frames = grouped_frames.apply(lambda df: df.sample(1))

    nframes = len(grouped_frames)

    features = ["NUC_shape_volume_lcc", "NUC_position_depth"]
    make_features(a, features, output_dir, dataset, scale)

    if do_frames:
        make_frames(grouped_frames, output_dir, dataset, scale)

    # write some kind of manifest
    featmap = {}
    for i in range(len(features)):
        featmap[features[i]] = "feature_" + str(i) + ".json"
    js = {
        "frames": ["frame_" + str(i) + ".png" for i in range(nframes)],
        "features": featmap,
        "outliers": "outliers.json",
        "tracks": "tracks.json",
        "times": "times.json",
        "centroids": "centroids.json",
        "bounds": "bounds.json",
    }
    with open(os.path.join(output_dir, dataset) + "/manifest.json", "w") as f:
        json.dump(js, f)

    logging.info("Finished writing dataset.")


parser = argparse.ArgumentParser()
parser.add_argument(
    "--output_dir",
    type=str,
    default="./data/",
    help="Parent directory to output to. Data will be written to a subdirectory named after the dataset parameter.",
)
parser.add_argument(
    "--dataset",
    type=str,
    default="baby_bear",
    help="Compatible named FMS dataset or FMS id to load. Will be loaded using `nuc_morph_analysis.preprocessing.load_data.load_dataset()`.",
)
parser.add_argument(
    "--noframes",
    action="store_true",
    help="If included, generates only the feature data, centroids, track data, and manifest, skipping the frame and bounding box generation.",
)
parser.add_argument(
    "--scale",
    type=float,
    default=1.0,
    help="Uniform scale factor that original image dimensions will be scaled by. 1 is original size, 0.5 is half-size in both X and Y.",
)

args = parser.parse_args()
if __name__ == "__main__":
    # Set up logging
    debug_file = args.output_dir + "debug.log"
    open(debug_file, "w").close()  # clear debug file if it exists
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[  # output to both log file and stdout stream
            logging.FileHandler(debug_file),
            logging.StreamHandler(),
        ],
    )
    logging.info("Starting...")
    make_dataset(
        output_dir=args.output_dir,
        dataset=args.dataset,
        do_frames=not args.noframes,
        scale=args.scale,
    )
