import { RGBAFormat, RGBAIntegerFormat, Texture, Vector2 } from "three";

import { MAX_FEATURE_CATEGORIES } from "../constants";
import { FeatureArrayType, FeatureDataType } from "./types";
import { AnalyticsEvent, triggerAnalyticsEvent } from "./utils/analytics";
import { getKeyFromName } from "./utils/data_utils";
import { AnyManifestFile, ManifestFile, ManifestFileMetadata, updateManifestVersion } from "./utils/dataset_utils";
import * as urlUtils from "./utils/url_utils";

import DataCache from "./DataCache";
import { IArrayLoader, IFrameLoader } from "./loaders/ILoader";
import ImageFrameLoader from "./loaders/ImageFrameLoader";
import JsonArrayLoader from "./loaders/JsonArrayLoader";
import Track from "./Track";

export enum FeatureType {
  CONTINUOUS = "continuous",
  DISCRETE = "discrete",
  CATEGORICAL = "categorical",
}

/**
 * Feature info loaded from the manifest file.
 * Does not include min/max or other data that needs to be fetched
 * from the feature JSON file.
 */
type FeatureInfo = {
  name: string;
  key: string;
  path: string;
  unit: string;
} & (
  | {
      type: FeatureType.CATEGORICAL;
      categories: string[];
    }
  | {
      type: FeatureType.CONTINUOUS | FeatureType.DISCRETE;
      categories: null;
    }
);

/**
 * Full feature data, loaded from a JSON file, with additional
 * manifest-provided metadata.
 */
export type FeatureData = FeatureInfo & {
  data: Float32Array;
  tex: Texture;
  min: number;
  max: number;
};

/** Feature data that can be stored in a DataCache. */
type FeatureCacheValue = { data: FeatureData; dispose: () => void };
type BackdropData = {
  name: string;
  frames: string[];
};

const defaultMetadata: ManifestFileMetadata = {
  frameDims: {
    width: 0,
    height: 0,
    units: "",
  },
  frameDurationSeconds: 0,
  startTimeSeconds: 0,
};

const MAX_CACHED_FRAMES = 60;
const MAX_CACHE_FEATURES = 100;

export default class Dataset {
  private frameLoader: IFrameLoader;
  private frameFiles: string[];
  private frames: DataCache<Texture> | null;
  private frameDimensions: Vector2 | null;

  private backdropLoader: IFrameLoader;
  private backdropData: Map<string, BackdropData>;
  // TODO: Implement caching for overlays-- extend FrameCache to allow multiple frames per index -> string name?
  // private backdrops: Map<string, FrameCache | null>;

  private arrayLoader: IArrayLoader;
  /** Ordered map from feature keys to feature info. */
  private featureInfo: Map<string, FeatureInfo>;
  private featureCache: DataCache<FeatureCacheValue>;

  private outlierFile?: string;
  public outliers?: Uint8Array | null;

  private tracksFile?: string;
  private timesFile?: string;
  public trackIds?: Uint32Array | null;
  public times?: Uint32Array | null;

  public centroidsFile?: string;
  public centroids?: Uint16Array | null;

  public boundsFile?: string;
  public bounds?: Uint16Array | null;

  public metadata: ManifestFileMetadata;

  public baseUrl: string;
  public manifestUrl: string;
  private hasOpened: boolean;

  public objectCount: number;

  /**
   * Constructs a new Dataset using the provided manifest path.
   * @param manifestUrl Must be a path to a .json manifest file.
   * @param frameLoader Optional.
   * @param arrayLoader Optional.
   */
  constructor(manifestUrl: string, frameLoader?: IFrameLoader, arrayLoader?: IArrayLoader) {
    this.manifestUrl = manifestUrl;

    this.baseUrl = urlUtils.formatPath(manifestUrl.substring(0, manifestUrl.lastIndexOf("/")));
    this.hasOpened = false;

    this.frameLoader = frameLoader || new ImageFrameLoader(RGBAIntegerFormat);
    this.frameFiles = [];
    this.frames = null;
    this.frameDimensions = null;
    this.featureCache = new DataCache(MAX_CACHE_FEATURES);

    this.backdropLoader = frameLoader || new ImageFrameLoader(RGBAFormat);
    this.backdropData = new Map();

    this.arrayLoader = arrayLoader || new JsonArrayLoader();
    this.featureInfo = new Map();
    this.metadata = defaultMetadata;
    this.objectCount = -1;
  }

  private resolveUrl = (url: string): string => `${this.baseUrl}/${url}`;

  private async fetchJson(url: string): Promise<AnyManifestFile> {
    const response = await urlUtils.fetchWithTimeout(url, urlUtils.DEFAULT_FETCH_TIMEOUT_MS);
    return await response.json();
  }

  private parseFeatureType(inputType: string | undefined, defaultType = FeatureType.CONTINUOUS): FeatureType {
    const isFeatureType = (inputType: string): inputType is FeatureType => {
      return Object.values(FeatureType).includes(inputType as FeatureType);
    };

    inputType = inputType?.toLowerCase() || "";
    return isFeatureType(inputType) ? inputType : defaultType;
  }

  /**
   * Parses the feature metadata from the manifest file into a FeatureInfo object and
   * validates its properties.
   * @param metadata The feature metadata from the manifest file.
   * @returns A FeatureInfo object with the parsed metadata.
   * @throws An error if the feature metadata is invalid (e.g., type is categorical but no categories are provided.)
   */
  private parseManifestFeatureData(metadata: ManifestFile["features"][number]): FeatureInfo {
    const name = metadata.name;
    const key = metadata.key || getKeyFromName(name);
    const featureType = this.parseFeatureType(metadata.type);
    const featureCategories = metadata?.categories || null;

    const featureInfo = {
      name,
      key,
      path: metadata.data,
      unit: metadata.unit || "",
    };

    // Validate feature type
    if (featureType === FeatureType.CATEGORICAL) {
      if (!featureCategories) {
        throw new Error(`Feature ${name} is categorical but no categories were provided.`);
      }
      if (featureCategories.length > MAX_FEATURE_CATEGORIES) {
        throw new Error(
          `Feature ${name} has too many categories (${featureCategories.length} > max ${MAX_FEATURE_CATEGORIES}).`
        );
      }
      return {
        ...featureInfo,
        type: FeatureType.CATEGORICAL,
        categories: featureCategories,
      };
    }
    return {
      ...featureInfo,
      type: featureType,
      categories: null,
    };
  }

  /**
   * Loads a feature from the dataset, fetching its data from the provided url.
   * @returns A promise of an array tuple containing the feature key and its FeatureData.
   */
  private async loadFeature(info: FeatureInfo): Promise<FeatureData> {
    const url = this.resolveUrl(info.path);
    const source = await this.arrayLoader.load(url);

    return {
      ...info,
      tex: source.getTexture(FeatureDataType.F32),
      data: source.getBuffer(FeatureDataType.F32),
      min: source.getMin(),
      max: source.getMax(),
    };
  }

  public hasFeatureKey(key: string): boolean {
    return this.featureKeys.includes(key);
  }

  /**
   * Returns the feature key if a feature with a matching key or name exists in the
   * dataset.
   * @param keyOrName String key or name of the feature to find.
   * @returns The feature key if found, otherwise undefined.
   */
  public findFeatureByKeyOrName(keyOrName: string): string | undefined {
    if (this.hasFeatureKey(keyOrName)) {
      return keyOrName;
    } else {
      return this.findFeatureKeyFromName(keyOrName);
    }
  }

  /**
   * Attempts to find a matching feature key for a feature name.
   * @returns The feature key if found, otherwise undefined.
   */
  public findFeatureKeyFromName(name: string): string | undefined {
    return Array.from(this.featureInfo.values()).find((f) => f.name === name)?.key;
  }

  /**
   * Attempts to get the feature data from this dataset for the given feature key.
   * Returns `undefined` if feature is not in the dataset.
   */
  public async getFeatureData(key: string): Promise<FeatureData | undefined> {
    const info = this.featureInfo.get(key);
    if (!info) {
      return undefined;
    }
    // Attempt to load the feature data if it hasn't been loaded yet.
    const featureData = this.featureCache.get(key);
    if (featureData) {
      return featureData.data;
    } else {
      const data = await this.loadFeature(info);
      this.featureCache.insert(key, { data, dispose: () => data.tex.dispose() });
      return data;
    }
  }

  /**
   * Marks the set of features that are currently in-use. This prevents internal caching from
   * removing or cleaning them up preemptively.
   * @param keys Set of feature keys that will be reserved. If a key is currently reserved but
   * is not in the set, it will be no longer be reserved and is subject to normal cache eviction.
   */
  public setReservedFeatureKeys(keys: Set<string>): void {
    this.featureCache.setReservedKeys(keys);
  }

  public getFeatureName(key: string): string | undefined {
    return this.featureInfo.get(key)?.name;
  }

  /**
   * Gets the feature's units if it exists; otherwise returns an empty string.
   */
  public getFeatureUnits(key: string): string {
    return this.featureInfo.get(key)?.unit || "";
  }

  public getFeatureNameWithUnits(key: string): string {
    const name = this.getFeatureName(key);
    if (!name) {
      return "N/A";
    }
    const units = this.getFeatureUnits(key);
    if (units) {
      return `${name} (${units})`;
    } else {
      return name;
    }
  }

  /**
   * Returns the FeatureType of the given feature, if it exists.
   * @param key Feature key to retrieve
   * @throws An error if the feature does not exist.
   * @returns The FeatureType of the given feature (categorical, continuous, or discrete)
   */
  public getFeatureType(key: string): FeatureType {
    const featureData = this.featureInfo.get(key);
    if (featureData === undefined) {
      throw new Error("Feature '" + key + "' does not exist in dataset.");
    }
    return featureData.type;
  }

  /**
   * Returns the array of string categories for the given feature, if it exists and is categorical.
   * @param key Feature key to retrieve.
   * @returns The array of string categories for the given feature, or null if the feature is not categorical.
   */
  public getFeatureCategories(key: string): string[] | null {
    const featureInfo = this.featureInfo.get(key);
    if (featureInfo === undefined) {
      throw new Error("Feature '" + key + "' does not exist in dataset.");
    }
    if (featureInfo.type === FeatureType.CATEGORICAL) {
      return featureInfo.categories;
    }
    return null;
  }

  /** Returns whether the given feature represents categorical data. */
  public isFeatureCategorical(key: string): boolean {
    const featureInfo = this.featureInfo.get(key);
    return featureInfo !== undefined && featureInfo.type === FeatureType.CATEGORICAL;
  }

  public isFeatureDataCategorical(data: FeatureData | null): boolean {
    return data !== null && data.type === FeatureType.CATEGORICAL;
  }

  /**
   * Fetches and loads a data file as an array and returns its data as a TypedArray using the provided dataType.
   * @param dataType The expected format of the data.
   * @param fileUrl String url of the file to be loaded.
   * @throws An error if `fileUrl` is not undefined and the data cannot be loaded from the file.
   * @returns Promise of a TypedArray loaded from the file. If `fileUrl` is undefined, returns null.
   */
  private async loadToBuffer<T extends FeatureDataType>(
    dataType: T,
    fileUrl?: string
  ): Promise<FeatureArrayType[T] | null> {
    if (!fileUrl) {
      return null;
    }
    try {
      const url = this.resolveUrl(fileUrl);
      const source = await this.arrayLoader.load(url);
      return source.getBuffer(dataType);
    } catch (e) {
      return null;
    }
  }

  public get numberOfFrames(): number {
    return this.frameFiles.length || 0;
  }

  public get featureKeys(): string[] {
    return Array.from(this.featureInfo.keys());
  }

  public get numObjects(): number {
    return this.objectCount;
  }

  /** Loads a single frame from the dataset */
  public async loadFrame(index: number): Promise<Texture | undefined> {
    if (index < 0 || index >= this.frameFiles.length) {
      return undefined;
    }

    const cachedFrame = this.frames?.get(index);
    if (cachedFrame) {
      this.frameDimensions = new Vector2(cachedFrame.image.width, cachedFrame.image.height);
      return cachedFrame;
    }

    // Allow for undefined or null frame files in the manifest
    if (this.frameFiles[index] === undefined || this.frameFiles[index] === null) {
      return undefined;
    }

    const fullUrl = this.resolveUrl(this.frameFiles[index]);
    const loadedFrame = await this.frameLoader.load(fullUrl);
    this.frameDimensions = new Vector2(loadedFrame.image.width, loadedFrame.image.height);
    this.frames?.insert(index, loadedFrame);
    return loadedFrame;
  }

  public hasBackdrop(key: string): boolean {
    return this.backdropData.has(key);
  }

  /**
   * Returns a map from backdrop keys to data.
   */
  public getBackdropData(): Map<string, BackdropData> {
    return new Map(this.backdropData);
  }

  public async loadBackdrop(key: string, index: number): Promise<Texture | undefined> {
    // TODO: Implement caching
    const frames = this.backdropData.get(key)?.frames;
    // TODO: Wrapping or clamping?
    if (!frames || index < 0 || index >= frames.length) {
      return undefined;
    }

    // Allow for undefined or null backdrop frames in the manifest
    if (this.frameFiles[index] === undefined || this.frameFiles[index] === null) {
      return undefined;
    }

    const fullUrl = this.resolveUrl(frames[index]);
    const loadedFrame = await this.backdropLoader.load(fullUrl);
    return loadedFrame;
  }

  /**
   * Gets the resolution of the last loaded frame.
   * If no frame has been loaded yet, returns (1,1)
   */
  public get frameResolution(): Vector2 {
    return this.frameDimensions || new Vector2(1, 1);
  }

  /**
   * Returns the value of a promise if it was resolved, or logs a warning and returns null if it was rejected.
   */
  private getPromiseValue<T>(promise: PromiseSettledResult<T>, failureWarning?: string): T | null {
    if (promise.status === "rejected") {
      if (failureWarning) {
        console.warn(failureWarning, promise.reason);
      }
      return null;
    }
    return promise.value;
  }

  /** Loads the dataset manifest and features. */
  public async open(manifestLoader = this.fetchJson): Promise<void> {
    if (this.hasOpened) {
      return;
    }
    this.hasOpened = true;

    const startTime = new Date();

    const manifest = updateManifestVersion(await manifestLoader(this.manifestUrl));
    this.frameFiles = manifest.frames;
    this.outlierFile = manifest.outliers;
    this.metadata = { ...defaultMetadata, ...manifest.metadata };
    console.log("Dataset metadata:", this.metadata);

    this.tracksFile = manifest.tracks;
    this.timesFile = manifest.times;
    this.centroidsFile = manifest.centroids;

    if (manifest.backdrops) {
      for (const { name, key, frames } of manifest.backdrops) {
        this.backdropData.set(key, { name, frames });
        if (frames.length !== this.frameFiles.length || 0) {
          // TODO: Show error message in the UI when this happens.
          throw new Error(
            `Number of frames (${this.frameFiles.length}) does not match number of images (${frames.length}) for backdrop '${key}'.`
          );
        }
      }
    }

    this.frames = new DataCache(MAX_CACHED_FRAMES);
    this.featureInfo = new Map(
      manifest.features.map((data) => {
        const info = this.parseManifestFeatureData(data);
        return [info.key, info];
      })
    );

    if (this.featureInfo.size === 0) {
      throw new Error("No features found in dataset. Is the dataset manifest file valid?");
    }

    const result = await Promise.allSettled([
      this.loadToBuffer(FeatureDataType.U8, this.outlierFile),
      this.loadToBuffer(FeatureDataType.U32, this.tracksFile),
      this.loadToBuffer(FeatureDataType.U32, this.timesFile),
      this.loadToBuffer(FeatureDataType.U16, this.centroidsFile),
      this.loadToBuffer(FeatureDataType.U16, this.boundsFile),
      this.loadFrame(0),
      this.loadFeature(Array.from(this.featureInfo.values())[0]),
    ]);
    const [outliers, tracks, times, centroids, bounds, _loadedFrame, loadedFeature] = result;

    // TODO: Add reporting pathway for Dataset.load?
    this.outliers = this.getPromiseValue(outliers, "Failed to load outliers: ");
    this.trackIds = this.getPromiseValue(tracks, "Failed to load tracks: ");
    this.times = this.getPromiseValue(times, "Failed to load times: ");
    this.centroids = this.getPromiseValue(centroids, "Failed to load centroids: ");
    this.bounds = this.getPromiseValue(bounds, "Failed to load bounds: ");

    if (times.status === "rejected") {
      throw new Error("Time data could not be loaded. Is the dataset manifest file valid?");
    }

    // TODO: What happens if the feature fails to load? Should that be a permanent error state?
    const featureData = this.getPromiseValue(loadedFeature, "Failed to load feature data: ");

    // Attempt to get the number of objects from any of the loaded data
    if (times.status === "fulfilled" && times.value) {
      this.objectCount = times.value.length;
    } else if (featureData) {
      this.objectCount = featureData.data.length;
    }

    // Analytics reporting
    triggerAnalyticsEvent(AnalyticsEvent.DATASET_LOAD, {
      datasetWriterVersion: this.metadata.writerVersion || "N/A",
      datasetTotalObjects: this.objectCount,
      datasetFeatureCount: this.featureInfo.size,
      datasetFrameCount: this.numberOfFrames,
      datasetLoadTimeMs: new Date().getTime() - startTime.getTime(),
    });

    // TODO: Dynamically fetch features
    // TODO: Pre-process feature data to handle outlier values by interpolating between known good values (#21)
  }

  /** Frees the GPU resources held by this dataset */
  public dispose(): void {
    this.featureCache.dispose();
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
      centroids = ids.reduce((result, i) => {
        result.push(this.centroids![2 * i], this.centroids![2 * i + 1]);
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

  /*
   * Get the times and values of a track for a given feature
   * this data is suitable to hand to d3 or plotly as two arrays of domain and range values
   */
  public buildTrackFeaturePlot(track: Track, featureData: FeatureData): { domain: number[]; range: number[] } {
    const range = track.ids.map((i) => featureData.data[i]);
    const domain = track.times;
    return { domain, range };
  }
}
