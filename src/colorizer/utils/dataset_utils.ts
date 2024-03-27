// Defines types for working with dataset manifests, and methods for
// updating manifests from one version to another.
import { getKeyFromName } from "./data_utils";
import { Spread } from "./type_utils";

// eslint-disable-next-line @typescript-eslint/naming-convention
type ManifestFileMetadataV0_0_0 = {
  /** Dimensions of the frame, in scale units. Default width and height are 0. */
  frameDims: {
    width: number;
    height: number;
    units: string;
  };
  frameDurationSeconds: number;
  /* Optional offset for the timestamp. */
  startTimeSeconds: number;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
type ManifestFileMetadataV1_1_0 = ManifestFileMetadataV0_0_0 &
  Partial<{
    name: string;
    description: string;
    author: string;
    datasetVersion: string;
    lastModified: string;
    dateCreated: string;
    revision: number;
    writerVersion: string;
  }>;

export type ManifestFileMetadata = Spread<ManifestFileMetadataV1_1_0>;

// eslint-disable-next-line @typescript-eslint/naming-convention
type ManifestFileV0_0_0 = {
  frames: string[];
  /** Deprecated; Map from feature name to relative path. */
  features: Record<string, string>;
  /** Deprecated; avoid using in new datasets. Instead, use the new `FeatureMetadata` spec. */
  featureMetadata?: Record<
    string,
    {
      units?: string | null;
      type?: string | null;
      categories?: string[] | null;
    }
  >;
  outliers?: string;
  tracks?: string;
  times?: string;
  centroids?: string;
  bounds?: string;
  metadata?: Partial<ManifestFileMetadataV0_0_0>;
};

// v1.0.0 removes the featureMetadata field, replaces the features map with an ordered
// array of metadata objects.
// eslint-disable-next-line @typescript-eslint/naming-convention
type ManifestFileV1_0_0 = Omit<ManifestFileV0_0_0, "features" | "featureMetadata" | "metadata"> & {
  features: {
    key?: string;
    name: string;
    data: string;
    units?: string;
    type?: string;
    categories?: string[];
  }[];
  /** Optional list of backdrop/overlay images. */
  backdrops?: { name: string; key: string; frames: string[] }[];
};

// v1.1.0 adds additional optional metadata fields.
// eslint-disable-next-line @typescript-eslint/naming-convention
type ManifestFileV1_1_0 = Spread<
  ManifestFileV1_0_0 & {
    metadata?: Partial<ManifestFileMetadataV1_1_0>;
  }
>;

/** Type definition for the dataset manifest JSON file. */
export type ManifestFile = ManifestFileV1_1_0;
/** Any manifest version, including deprecated manifests. Call `update_manifest_version` to transform to an up-to-date version. */
export type AnyManifestFile = ManifestFileV0_0_0 | ManifestFileV1_0_0 | ManifestFileV1_1_0;

///////////// Conversion functions /////////////////////

/**
 * Returns whether the dataset is using the older, deprecated manifest format, where feature metadata
 * was stored in a separate object from the `feature` file path declaration.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
function isV0_0_0(manifest: AnyManifestFile): manifest is ManifestFileV0_0_0 {
  return typeof Object.values(manifest.features)[0] === "string";
}

/**
 * Converts potentially outdated manifests to the latest manifest format.
 * @param manifest Manifest object, as parsed from a JSON file.
 * @returns An object with fields reflecting the most recent ManifestFile spec.
 */
export const updateManifestVersion = (manifest: AnyManifestFile): ManifestFile => {
  if (isV0_0_0(manifest)) {
    // Parse feature metadata into the new features format
    const features: ManifestFile["features"] = [];
    for (const [featureName, featurePath] of Object.entries(manifest.features)) {
      const featureMetadata = manifest.featureMetadata?.[featureName];
      features.push({
        name: featureName,
        key: getKeyFromName(featureName),
        data: featurePath,
        units: featureMetadata?.units || undefined,
        type: featureMetadata?.type || undefined,
        categories: featureMetadata?.categories || undefined,
      });
    }

    manifest = {
      ...manifest,
      features,
    };
  }

  return manifest;
};
