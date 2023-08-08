import { Texture, Vector2 } from "three";

import { IArrayLoader, IFrameLoader } from "./loaders/ILoader";
import JsonArrayLoader from "./loaders/JsonArrayLoader";
import ImageFrameLoader from "./loaders/ImageFrameLoader";

import FrameCache from "./FrameCache";
import Track from "./Track";

import { FeatureArrayType, FeatureDataType } from "./types";
import { TypedArray } from "plotly.js-dist-min";

type DatasetManifest = {
  frames: string[];
  features: Record<string, string>;
  outliers?: string;
  tracks?: string;
  times?: string;
  centroids?: string;
  bounds?: string;
};

export type FeatureData = {
  data: Float32Array;
  tex: Texture;
  min: number;
  max: number;
};

const MAX_CACHED_FRAMES = 60;
const MANIFEST_FILENAME = "manifest.json";

export default class Dataset {
  private frameLoader: IFrameLoader;
  private frameFiles: string[];
  private frames: FrameCache | null;
  private frameDimensions: Vector2 | null;

  private arrayLoader: IArrayLoader;
  private featureFiles: Record<string, string>;
  public features: Record<string, FeatureData>;

  private outlierFile?: string;
  public outliers?: Texture;

  private tracksFile?: string;
  private timesFile?: string;
  public trackIds?: Uint32Array;
  public times?: Uint32Array;

  public centroidsFile?: string;
  public centroids?: Uint16Array;
  // TODO: This is currently a hardcoded value due to a scaling issue in the centroid data.
  // Add definition for scale factor to the manifest, or fix centroid data so it matches the frame resolution.
  public centroidScaleFactor?: number = 0.25;

  public boundsFile?: string;
  public bounds?: Uint16Array;

  public baseUrl: string;
  private hasOpened: boolean;

  constructor(baseUrl: string, frameLoader?: IFrameLoader, arrayLoader?: IArrayLoader) {
    this.baseUrl = baseUrl;
    if (this.baseUrl.endsWith("/")) {
      this.baseUrl = this.baseUrl.slice(0, this.baseUrl.length - 1);
    }
    this.hasOpened = false;

    this.frameLoader = frameLoader || new ImageFrameLoader();
    this.frameFiles = [];
    this.frames = null;
    this.frameDimensions = null;

    this.arrayLoader = arrayLoader || new JsonArrayLoader();
    this.featureFiles = {};
    this.features = {};
  }

  private resolveUrl = (url: string): string => `${this.baseUrl}/${url}`;

  private async fetchManifest(): Promise<DatasetManifest> {
    const response = await fetch(this.resolveUrl(MANIFEST_FILENAME));
    return await response.json();
  }

  private async loadFeature(name: string): Promise<void> {
    const url = this.resolveUrl(this.featureFiles[name]);
    const source = await this.arrayLoader.load(url);
    this.features[name] = {
      tex: source.getTexture(FeatureDataType.F32),
      data: source.getBuffer(FeatureDataType.F32),
      min: source.getMin(),
      max: source.getMax(),
    };
  }

  public hasFeature(name: string): boolean {
    return this.featureNames.includes(name);
  }

  public getFeatureData(name: string): FeatureData | null {
    if (Object.keys(this.features).includes(name)) {
      return this.features[name];
    } else {
      return null;
    }
  }

  /**
   * Fetches and loads a data file as an array and returns its data as a Texture using the provided dataType.
   * @param dataType The expected format of the data.
   * @param fileUrl String url of the file to be loaded.
   * @throws An error if fileUrl is undefined or if the data cannot be loaded from the file.
   * @returns Promise of a texture loaded from the file.
   */
  private async loadToTexture(dataType: FeatureDataType, fileUrl?: string): Promise<Texture> {
    if (!fileUrl) {
      throw Error("File URL is not defined. No data can be loaded.");
    }
    const url = this.resolveUrl(fileUrl);
    const source = await this.arrayLoader.load(url);
    return source.getTexture(dataType);
  }

  /**
   * Fetches and loads a data file as an array and returns its data as a TypedArray using the provided dataType.
   * @param dataType The expected format of the data.
   * @param fileUrl String url of the file to be loaded.
   * @throws An error if fileUrl is undefined or if the data cannot be loaded from the file.
   * @returns Promise of a TypedArray loaded from the file.
   */
  private async loadToBuffer<T extends FeatureDataType>(dataType: T, fileUrl?: string): Promise<FeatureArrayType[T]> {
    if (!fileUrl) {
      throw Error("File URL is not defined. No data can be loaded.");
    }
    const url = this.resolveUrl(fileUrl);
    const source = await this.arrayLoader.load(url);
    return source.getBuffer(dataType);
  }

  public get numberOfFrames(): number {
    return this.frames?.length || 0;
  }

  public get featureNames(): string[] {
    return Object.keys(this.featureFiles);
  }

  /** Loads a single frame from the dataset */
  public async loadFrame(index: number): Promise<Texture | undefined> {
    if (index < 0 || index >= this.frameFiles.length) {
      return undefined;
    }

    const cachedFrame = this.frames?.get(index);
    if (cachedFrame) {
      return cachedFrame;
    }

    const fullUrl = this.resolveUrl(this.frameFiles[index]);
    const loadedFrame = await this.frameLoader.load(fullUrl);
    this.frameDimensions = new Vector2(loadedFrame.image.width, loadedFrame.image.height);
    this.frames?.insert(index, loadedFrame);
    return loadedFrame;
  }

  /**
   * Gets the resolution of the last loaded frame.
   * If no frame has been loaded yet, returns (1,1)
   */
  public get frameResolution(): Vector2 {
    return this.frameDimensions || new Vector2(1, 1);
  }

  /** Loads the dataset manifest and features */
  public async open(): Promise<void> {
    if (this.hasOpened) {
      return;
    }
    this.hasOpened = true;

    const manifest = await this.fetchManifest();

    this.frameFiles = manifest.frames;
    this.featureFiles = manifest.features;
    this.outlierFile = manifest.outliers;
    this.tracksFile = manifest.tracks;
    this.timesFile = manifest.times;
    this.centroidsFile = manifest.centroids;

    this.frames = new FrameCache(this.frameFiles.length, MAX_CACHED_FRAMES);
    const promises = this.featureNames.map(this.loadFeature.bind(this));

    const loadOutlier = async () => {
      this.outliers = await this.loadToTexture(FeatureDataType.U8, this.outlierFile);
    };
    const loadTracks = async () => {
      this.trackIds = await this.loadToBuffer(FeatureDataType.U32, this.tracksFile);
    };
    const loadTimes = async () => {
      this.times = await this.loadToBuffer(FeatureDataType.U32, this.timesFile);
    };
    const loadCentroids = async () => {
      this.centroids = await this.loadToBuffer(FeatureDataType.U16, this.centroidsFile);
    };
    const loadBounds = async () => {
      this.bounds = await this.loadToBuffer(FeatureDataType.U16, this.boundsFile);
    };
    promises.push(loadOutlier());
    promises.push(loadTracks());
    promises.push(loadTimes());
    promises.push(loadCentroids());
    promises.push(loadBounds());

    await Promise.allSettled(promises);

    // TODO: Dynamically fetch features
    // TODO: Pre-process feature data to handle outlier values by interpolating between known good values (#21)
  }

  /** Frees the GPU resources held by this dataset */
  public dispose(): void {
    Object.values(this.features).forEach(({ tex }) => tex.dispose());
    this.frames?.dispose();
  }

  /** get frame index of a given cell id */
  public getTime(index: number): number {
    return this.times?.[index] || 0;
  }

  /** get track id of a given cell id */
  public getTrackId(index: number): number {
    return this.trackIds?.[index] || 0;
  }

  private getIdsOfTrack(trackId: number): number[] {
    return this.trackIds?.reduce((arr: number[], elem: number, ind: number) => {
      if (elem === trackId) arr.push(ind);
      return arr;
    }, []) as number[];
  }

  public buildTrack(trackId: number): Track {
    // trackIds contains a track id for every cell id in order.
    // get all cell ids for given track
    const ids = this.trackIds ? this.getIdsOfTrack(trackId) : [];
    // ids now contains all cell ids that have trackId.
    // get all the times for those cells, in the same order
    const times = this.times ? ids.map((i) => (this.times ? this.times[i] : 0)) : [];

    let centroids: number[] = [];
    if (this.centroids) {
      // TODO: Replace, remove, or document scale factor. See above note.
      const scaleFactor = this.centroidScaleFactor || 1;
      centroids = ids.reduce((result, i) => {
        result.push(this.centroids![2 * i] * scaleFactor, this.centroids![2 * i + 1] * scaleFactor);
        return result;
      }, [] as number[]);
    }

    let bounds: number[] = [];
    if (this.bounds) {
      bounds = ids.reduce((result, i) => {
        result.push(this.bounds![4 * i], this.bounds![4 * i + 1], this.bounds![4 * i + 2], this.bounds![4 * i + 3]);
        return result;
      }, [] as number[]);
    }

    return new Track(trackId, times, ids, centroids, bounds);
  }

  // get the times and values of a track for a given feature
  // this data is suitable to hand to d3 or plotly as two arrays of domain and range values
  public buildTrackFeaturePlot(track: Track, feature: string): { domain: number[]; range: number[] } {
    const range = track.ids.map((i) => this.features[feature].data[i]);
    const domain = track.times;
    return { domain, range };
  }
}
