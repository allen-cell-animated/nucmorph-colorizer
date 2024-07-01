// Typescript doesn't recognize RequestInit

/* global RequestInit */
import { Color, ColorRepresentation, HexColorString } from "three";

import { MAX_FEATURE_CATEGORIES } from "../../constants";
import {
  DEFAULT_CATEGORICAL_PALETTE_KEY,
  getKeyFromPalette,
  KNOWN_CATEGORICAL_PALETTES,
} from "../colors/categorical_palettes";
import {
  defaultViewerConfig,
  DrawSettings,
  FeatureThreshold,
  isDrawMode,
  isTabType,
  isThresholdCategorical,
  PlotRangeType,
  ScatterPlotConfig,
  ThresholdType,
  ViewerConfig,
} from "../types";
import { numberToStringDecimal } from "./math_utils";

enum UrlParam {
  TRACK = "track",
  DATASET = "dataset",
  FEATURE = "feature",
  TIME = "t",
  COLLECTION = "collection",
  THRESHOLDS = "filters",
  RANGE = "range",
  COLOR_RAMP = "color",
  COLOR_RAMP_REVERSED_SUFFIX = "!",
  PALETTE = "palette",
  PALETTE_KEY = "palette-key",
  BACKDROP_KEY = "bg-key",
  BACKDROP_BRIGHTNESS = "bg-brightness",
  BACKDROP_SATURATION = "bg-sat",
  FOREGROUND_ALPHA = "fg-alpha",
  OUTLIER_MODE = "outlier-mode",
  OUTLIER_COLOR = "outlier-color",
  FILTERED_MODE = "filter-mode",
  FILTERED_COLOR = "filter-color",
  SHOW_PATH = "path",
  SHOW_SCALEBAR = "scalebar",
  SHOW_TIMESTAMP = "timestamp",
  KEEP_RANGE = "keep-range",
  SCATTERPLOT_X_AXIS = "scatter-x",
  SCATTERPLOT_Y_AXIS = "scatter-y",
  SCATTERPLOT_RANGE_MODE = "scatter-range",
  OPEN_TAB = "tab",
}

const ALLEN_FILE_PREFIX = "/allen/";
const ALLEN_PREFIX_TO_HTTPS: Record<string, string> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "/allen/aics/assay-dev": "https://dev-aics-dtp-001.int.allencell.org/assay-dev",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "/allen/aics/microscopy": "https://dev-aics-dtp-001.int.allencell.org/microscopy",
};

export type UrlParams = {
  collection: string;
  dataset: string;
  /** Either feature key or feature name. */
  feature: string;
  track: number;
  time: number;
  thresholds: FeatureThreshold[];
  range: [number, number];
  colorRampKey: string | null;
  colorRampReversed: boolean | null;
  categoricalPalette: Color[];
  config: Partial<ViewerConfig>;
  selectedBackdropKey: string | null;
  scatterPlotConfig: Partial<ScatterPlotConfig>;
};

export const DEFAULT_FETCH_TIMEOUT_MS = 2000;

/**
 * Initiates a fetch request with a given timeout, returning a promise that will reject if the timeout is reached.
 * @param url fetch request URL
 * @param timeoutMs timeout before the request should fail, in milliseconds. Defaults to `DEFAULT_FETCH_TIMEOUT_MS`.
 * @param options additional
 * @returns a Response promise, as returned by `fetch(url, options)`. The promise will reject if the timeout is exceeded.
 */
export function fetchWithTimeout(
  url: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  options?: RequestInit
): Promise<Response> {
  const fetchPromise = fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...options });
  return fetchPromise;
}

/**
 * Serializes the threshold into a string that can be used as a URL parameter.
 *
 * @param threshold FeatureThreshold to serialize.
 * @returns A string representing the threshold.
 * - For numeric features, the threshold is serialized as `featureKey:unit:min:max`.
 * - For categorical features, the threshold is serialized as `featureKey:unit:selected_hex`,
 * where `selected_hex` is the hex form of a binary number representing what categories are selected.
 *
 * The i-th place of the binary number is `1` if the i-th category in the feature's category list is enabled.
 *
 * ex: If there are five categories and the first and third categories are enabled,
 * then `threshold.enabledCategories=[true, false, true, false, false]`.
 * The binary representation is `00101`, which is `0x05` in hex.
 */
function serializeThreshold(threshold: FeatureThreshold): string {
  // featureKey + units are encoded in case it contains special characters (":" or ",").
  // TODO: remove once feature keys are implemented.
  const featureKey = encodeURIComponent(threshold.featureKey);
  const featureUnit = encodeURIComponent(threshold.unit);

  // TODO: Are there better characters I can be using here? ":" and "," take up
  // more space in the URL. -> once features are converted to use keys, use "-" as a separator here? "|"?
  if (isThresholdCategorical(threshold)) {
    // Interpret the selected categories as binary digits, then convert to a hex string.
    let selectedBinary = 0;
    for (let i = 0; i < threshold.enabledCategories.length; i++) {
      selectedBinary |= (threshold.enabledCategories[i] ? 1 : 0) << i;
    }
    const selectedHex = selectedBinary.toString(16);
    return `${featureKey}:${featureUnit}:${selectedHex}`;
  } else {
    // Numeric feature
    const min = numberToStringDecimal(threshold.min, 3);
    const max = numberToStringDecimal(threshold.max, 3);
    return `${featureKey}:${featureUnit}:${min}:${max}`;
  }
}

/**
 * Deserializes a single threshold string into a FeatureThreshold object.
 * @param thresholdString Threshold string to parse.
 * @returns
 * - A FeatureThreshold object if the string was successfully parsed.
 * - `undefined` if the string could not be parsed.
 */
function deserializeThreshold(thresholdString: string): FeatureThreshold | undefined {
  const [featureKey, featureUnit, ...selection] = thresholdString.split(":");
  if (featureKey === undefined || featureUnit === undefined) {
    console.warn(
      "url_utils.deserializeThreshold: Could not parse threshold string: '" +
        thresholdString +
        "'; feature key and/or units missing."
    );
    return undefined;
  }
  let threshold: FeatureThreshold;
  if (selection.length === 1) {
    // Feature is a category
    const enabledCategories = [];
    const selectedHex = selection[0];
    const selectedBinary = parseInt(selectedHex, 16);
    for (let i = 0; i < MAX_FEATURE_CATEGORIES; i++) {
      enabledCategories.push((selectedBinary & (1 << i)) !== 0);
    }
    threshold = {
      featureKey: decodeURIComponent(featureKey),
      unit: decodeURIComponent(featureUnit),
      type: ThresholdType.CATEGORICAL,
      enabledCategories,
    };
  } else if (selection.length === 2) {
    // Feature is numeric and a range.
    threshold = {
      featureKey: decodeURIComponent(featureKey),
      unit: decodeURIComponent(featureUnit),
      type: ThresholdType.NUMERIC,
      min: parseFloat(selection[0]),
      max: parseFloat(selection[1]),
    };
    // Enforce min/max ordering
    if (threshold.min > threshold.max) {
      threshold = { ...threshold, min: threshold.max, max: threshold.min };
    }
  } else {
    // Unknown parameters but we can still make a dummy threshold with the name + unit
    console.warn(
      `url_utils.deserializeThreshold: invalid threshold '${thresholdString}' has too many or too few parameters.`
    );
    threshold = {
      featureKey: decodeURIComponent(featureKey),
      unit: decodeURIComponent(featureUnit),
      type: ThresholdType.NUMERIC,
      min: NaN,
      max: NaN,
    };
  }
  return threshold;
}

function serializeThresholds(thresholds: FeatureThreshold[]): string {
  return thresholds.map(serializeThreshold).join(",");
}

function deserializeThresholds(thresholds: string | null): FeatureThreshold[] | undefined {
  if (!thresholds) {
    return undefined;
  }
  return thresholds.split(",").reduce((acc, thresholdString) => {
    const thresholdOrUndefined = deserializeThreshold(thresholdString);
    if (thresholdOrUndefined) {
      acc.push(thresholdOrUndefined);
    }
    return acc;
  }, [] as FeatureThreshold[]);
}

/**
 * If the boolean parameter is defined, serializes it as a string and adds it to the parameters array.
 */
function tryAddBooleanParam(parameters: string[], value: boolean | undefined, key: string): void {
  if (value !== undefined) {
    parameters.push(`${key}=${value ? "1" : "0"}`);
  }
}

function serializeViewerConfig(config: Partial<ViewerConfig>): string[] {
  const parameters: string[] = [];
  // Backdrop
  if (config.backdropSaturation !== undefined) {
    parameters.push(`${UrlParam.BACKDROP_SATURATION}=${config.backdropSaturation}`);
  }
  if (config.backdropBrightness !== undefined) {
    parameters.push(`${UrlParam.BACKDROP_BRIGHTNESS}=${config.backdropBrightness}`);
  }

  // Foreground
  if (config.objectOpacity !== undefined) {
    parameters.push(`${UrlParam.FOREGROUND_ALPHA}=${config.objectOpacity}`);
  }

  // Outlier + filter colors
  if (config.outlierDrawSettings) {
    parameters.push(`${UrlParam.OUTLIER_COLOR}=${config.outlierDrawSettings.color.getHexString()}`);
    parameters.push(`${UrlParam.OUTLIER_MODE}=${config.outlierDrawSettings.mode}`);
  }
  if (config.outOfRangeDrawSettings) {
    parameters.push(`${UrlParam.FILTERED_COLOR}=${config.outOfRangeDrawSettings.color.getHexString()}`);
    parameters.push(`${UrlParam.FILTERED_MODE}=${config.outOfRangeDrawSettings.mode}`);
  }
  if (config.openTab) {
    parameters.push(`${UrlParam.OPEN_TAB}=${config.openTab}`);
  }

  tryAddBooleanParam(parameters, config.showScaleBar, UrlParam.SHOW_SCALEBAR);
  tryAddBooleanParam(parameters, config.showTimestamp, UrlParam.SHOW_TIMESTAMP);
  tryAddBooleanParam(parameters, config.showTrackPath, UrlParam.SHOW_PATH);
  tryAddBooleanParam(parameters, config.keepRangeBetweenDatasets, UrlParam.KEEP_RANGE);

  return parameters;
}

export function isHexColor(value: string | null): value is HexColorString {
  const hexRegex = /^#([0-9a-f]{3}){1,2}$/;
  return value !== null && hexRegex.test(value);
}

function parseDrawSettings(color: string | null, mode: string | null, defaultSettings: DrawSettings): DrawSettings {
  const modeInt = parseInt(mode || "-1", 10);
  const hexColor = "#" + color;
  return {
    color: isHexColor(hexColor) ? new Color(hexColor) : defaultSettings.color,
    mode: mode && isDrawMode(modeInt) ? modeInt : defaultSettings.mode,
  };
}

function getBooleanParam(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  return value === "1";
}

function deserializeViewerConfig(params: URLSearchParams): Partial<ViewerConfig> | undefined {
  const newConfig: Partial<ViewerConfig> = {};
  if (params.get(UrlParam.BACKDROP_SATURATION)) {
    newConfig.backdropSaturation = parseInt(params.get(UrlParam.BACKDROP_SATURATION)!, 10);
  }
  if (params.get(UrlParam.BACKDROP_BRIGHTNESS)) {
    newConfig.backdropBrightness = parseInt(params.get(UrlParam.BACKDROP_BRIGHTNESS)!, 10);
  }
  if (params.get(UrlParam.FOREGROUND_ALPHA)) {
    newConfig.objectOpacity = parseInt(params.get(UrlParam.FOREGROUND_ALPHA)!, 10);
  }
  if (params.get(UrlParam.OUTLIER_COLOR) || params.get(UrlParam.OUTLIER_MODE)) {
    newConfig.outlierDrawSettings = parseDrawSettings(
      params.get(UrlParam.OUTLIER_COLOR),
      params.get(UrlParam.OUTLIER_MODE),
      defaultViewerConfig.outlierDrawSettings
    );
  }
  if (params.get(UrlParam.FILTERED_COLOR) || params.get(UrlParam.FILTERED_MODE)) {
    newConfig.outOfRangeDrawSettings = parseDrawSettings(
      params.get(UrlParam.FILTERED_COLOR),
      params.get(UrlParam.FILTERED_MODE),
      defaultViewerConfig.outOfRangeDrawSettings
    );
  }
  const openTab = params.get(UrlParam.OPEN_TAB);
  if (openTab && isTabType(openTab)) {
    newConfig.openTab = openTab;
  }

  newConfig.showScaleBar = getBooleanParam(params.get(UrlParam.SHOW_SCALEBAR));
  newConfig.showTimestamp = getBooleanParam(params.get(UrlParam.SHOW_TIMESTAMP));
  newConfig.showTrackPath = getBooleanParam(params.get(UrlParam.SHOW_PATH));
  newConfig.keepRangeBetweenDatasets = getBooleanParam(params.get(UrlParam.KEEP_RANGE));

  const finalConfig = removeUndefinedProperties(newConfig);
  return Object.keys(finalConfig).length === 0 ? undefined : finalConfig;
}

const rangeTypeToUrlParam: Record<PlotRangeType, string> = {
  [PlotRangeType.ALL_TIME]: "all",
  [PlotRangeType.CURRENT_TRACK]: "track",
  [PlotRangeType.CURRENT_FRAME]: "frame",
};

const urlParamToRangeType: Record<string, PlotRangeType> = {
  all: PlotRangeType.ALL_TIME,
  track: PlotRangeType.CURRENT_TRACK,
  frame: PlotRangeType.CURRENT_FRAME,
};

function serializeScatterPlotConfig(config: Partial<ScatterPlotConfig>): string[] {
  const parameters: string[] = [];
  if (config.rangeType) {
    const rangeString = rangeTypeToUrlParam[config.rangeType];
    parameters.push(`${UrlParam.SCATTERPLOT_RANGE_MODE}=${rangeString}`);
  }
  config.xAxis && parameters.push(`${UrlParam.SCATTERPLOT_X_AXIS}=${encodeURIComponent(config.xAxis)}`);
  config.yAxis && parameters.push(`${UrlParam.SCATTERPLOT_Y_AXIS}=${encodeURIComponent(config.yAxis)}`);
  return parameters;
}

function deserializeScatterPlotConfig(params: URLSearchParams): Partial<ScatterPlotConfig> | undefined {
  const newConfig: Partial<ScatterPlotConfig> = {};
  const rangeString = params.get(UrlParam.SCATTERPLOT_RANGE_MODE);
  if (rangeString && urlParamToRangeType[rangeString]) {
    newConfig.rangeType = urlParamToRangeType[rangeString];
  }
  const xAxis = decodePossiblyNullString(params.get(UrlParam.SCATTERPLOT_X_AXIS));
  const yAxis = decodePossiblyNullString(params.get(UrlParam.SCATTERPLOT_Y_AXIS));
  if (xAxis) {
    newConfig.xAxis = xAxis;
  }
  if (yAxis) {
    newConfig.yAxis = yAxis;
  }
  const finalConfig = removeUndefinedProperties(newConfig);
  return Object.keys(finalConfig).length === 0 ? undefined : finalConfig;
}

/**
 * Creates a url query string from parameters that can be appended onto the base URL.
 *
 * @param state: An object matching any of the properties of `UrlParams`.
 * - `collection`: string path to the collection. Ignores paths matching the default collection address.
 * - `dataset`: string name or URL of the dataset.
 * - `feature`: string name of the feature.
 * - `track`: integer track number.
 * - `time`: integer frame number.
 * - `thresholds`: array of feature threshold.
 * - `range`: array of two numbers, representing the min and max of the color map range.
 * - `colorRampKey`: the key of the current color map.
 * - `colorRampReversed`: boolean, whether the color map is reversed.
 * - `categoricalPalette`: an array of (three.js) Color objects representing the current color palette to use.
 *
 * @returns
 * - If no parameters are present or valid, returns an empty string.
 * - Else, returns a string of URL parameters that can be appended to the URL directly (ex: `?collection=<some_url>&time=23`).
 */
export function paramsToUrlQueryString(state: Partial<UrlParams>): string {
  // Get parameters, ignoring null/empty values
  const includedParameters: string[] = [];

  if (state.collection) {
    includedParameters.push(`${UrlParam.COLLECTION}=${encodeURIComponent(state.collection)}`);
  }
  if (state.dataset) {
    includedParameters.push(`${UrlParam.DATASET}=${encodeURIComponent(state.dataset)}`);
  }
  if (state.feature) {
    includedParameters.push(`${UrlParam.FEATURE}=${encodeURIComponent(state.feature)}`);
  }
  if (state.track !== undefined) {
    includedParameters.push(`${UrlParam.TRACK}=${state.track}`);
  }
  if (state.time !== undefined) {
    includedParameters.push(`${UrlParam.TIME}=${state.time}`);
  }
  if (state.thresholds && state.thresholds.length > 0) {
    includedParameters.push(`${UrlParam.THRESHOLDS}=${encodeURIComponent(serializeThresholds(state.thresholds))}`);
  }
  if (state.range && state.range.length === 2) {
    const rangeString = `${numberToStringDecimal(state.range[0], 3)},${numberToStringDecimal(state.range[1], 3)}`;
    includedParameters.push(`${UrlParam.RANGE}=${encodeURIComponent(rangeString)}`);
  }
  if (state.colorRampKey) {
    if (state.colorRampReversed) {
      includedParameters.push(
        `${UrlParam.COLOR_RAMP}=${encodeURIComponent(state.colorRampKey + UrlParam.COLOR_RAMP_REVERSED_SUFFIX)}`
      );
    } else {
      includedParameters.push(`${UrlParam.COLOR_RAMP}=${encodeURIComponent(state.colorRampKey)}`);
    }
  }
  if (state.categoricalPalette) {
    const key = getKeyFromPalette(state.categoricalPalette);
    if (key !== null) {
      includedParameters.push(`${UrlParam.PALETTE_KEY}=${key}`);
    } else {
      // Save the hex color stops as a string separated by dashes.
      // TODO: Save only the edited colors to shorten URL.
      const stops = state.categoricalPalette.map((color: Color) => {
        return color.getHexString();
      });
      includedParameters.push(`${UrlParam.PALETTE}=${stops.join("-")}`);
    }
  }
  if (state.config) {
    includedParameters.push(...serializeViewerConfig(state.config));
  }
  if (state.selectedBackdropKey) {
    includedParameters.push(`${UrlParam.BACKDROP_KEY}=${encodeURIComponent(state.selectedBackdropKey)}`);
  }
  if (state.scatterPlotConfig) {
    includedParameters.push(...serializeScatterPlotConfig(state.scatterPlotConfig));
  }

  // If parameters present, join with URL syntax and push into the URL
  return includedParameters.length > 0 ? "?" + includedParameters.join("&") : "";
}

/**
 * Returns if a string is a URL where resources can be fetched from, rather than just a
 * string name.
 * @param input String to be checked.
 * @returns True if a string is a web resource `http(s)://` or an internal resource `//`.
 */
export function isUrl(input: string | null): boolean {
  // Check for strings that start with http(s):// or a double-slash (//).
  return input !== null && (/^http(s)*:\/\//.test(input) || /^\/\//.test(input));
}

/**
 * Normalizes a file path to use only single forward slashes. Replaces
 * backwards slashes with forward slashes, and removes double slashes.
 */
function normalizeFilePathSlashes(input: string): string {
  // Replace all backslashes with forward slashes
  input = input.replaceAll("\\", "/");
  // Replace double slashes with single
  input = input.replaceAll("//", "/");
  return input;
}

/**
 * Returns whether the input string is a path to an Allen file server resource.
 * Matches any path that starts with `/allen/`, normalizing for backwards and double slashes.
 */
export function isAllenPath(input: string): boolean {
  return normalizeFilePathSlashes(input).startsWith(ALLEN_FILE_PREFIX);
}

/**
 * Attempts to convert an Allen path to an HTTPS resource path.
 * @returns Returns null if the path was not recognized or could not be converted,
 * otherwise, returns an HTTPS resource path.
 */
export function convertAllenPathToHttps(input: string): string | null {
  input = normalizeFilePathSlashes(input);
  for (const prefix of Object.keys(ALLEN_PREFIX_TO_HTTPS)) {
    if (input.startsWith(prefix)) {
      return input.replace(prefix, ALLEN_PREFIX_TO_HTTPS[prefix]);
    }
  }
  return null;
}

/**
 * Decodes strings using `decodeURIComponent`, handling null inputs.
 */
function decodePossiblyNullString(input: string | null): string | null {
  return input === null ? null : decodeURIComponent(input);
}

export function isBlob(path: string): boolean {
  return /^blob:/.test(path);
}

/**
 * Returns whether the input string is a path to a .json file.
 * @param path The string path to test.
 * @returns true if input ends in `.json`.
 */
export function isJson(path: string): boolean {
  return /.json$/.test(path);
}

/**
 * Removes trailing slashes and whitespace from a path or url string.
 * @param input the string to be formatted.
 * @returns the string, but with trailing slashes and whitespace at the beginning or end removed.
 */
export function formatPath(input: string): string {
  input = input.trim();
  if (input.charAt(input.length - 1) === "/") {
    input = input.slice(0, input.length - 1);
  }
  if (input.charAt(0) === "/") {
    input = input.slice(1);
  }
  return input.trim();
}

/**
 * Returns a copy of an object where any properties with a value of `undefined`
 * are not included.
 */
function removeUndefinedProperties<T>(object: T): Partial<T> {
  const ret: Partial<T> = {};
  for (const key in object) {
    if (object[key] !== undefined) {
      ret[key] = object[key];
    }
  }
  return ret;
}

/**
 * Loads viewer parameters from a URLSearchParams object.
 * @param queryString A URLSearchParams object.
 * @returns A partial UrlParams object with values loaded from the queryString.
 * Enforces min/max ordering for thresholds and range.
 */
export function loadFromUrlSearchParams(urlParams: URLSearchParams): Partial<UrlParams> {
  const base10Radix = 10; // required for parseInt
  const collectionParam = urlParams.get(UrlParam.COLLECTION) ?? undefined;
  const datasetParam = urlParams.get(UrlParam.DATASET) ?? undefined;
  const featureParam = urlParams.get(UrlParam.FEATURE) ?? undefined;
  const trackParam = urlParams.get(UrlParam.TRACK) ? parseInt(urlParams.get(UrlParam.TRACK)!, base10Radix) : undefined;
  // This assumes there are no negative timestamps in the dataset
  const timeParam = urlParams.get(UrlParam.TIME) ? parseInt(urlParams.get(UrlParam.TIME)!, base10Radix) : undefined;

  // Parse and validate thresholds
  const thresholdsParam = deserializeThresholds(urlParams.get(UrlParam.THRESHOLDS));

  let rangeParam: [number, number] | undefined = undefined;
  const rawRangeParam = decodePossiblyNullString(urlParams.get(UrlParam.RANGE));
  if (rawRangeParam) {
    const [min, max] = rawRangeParam.split(",");
    rangeParam = [parseFloat(min), parseFloat(max)];
    // Enforce min/max ordering
    if (rangeParam[0] > rangeParam[1]) {
      rangeParam.reverse();
    }
  }

  const colorRampRawParam = urlParams.get(UrlParam.COLOR_RAMP);
  let colorRampParam: string | undefined = colorRampRawParam || undefined;
  let colorRampReversedParam: boolean | undefined = undefined;
  //  Color ramps are marked as reversed by adding ! to the end of the key
  if (
    colorRampRawParam &&
    colorRampRawParam.charAt(colorRampRawParam.length - 1) === UrlParam.COLOR_RAMP_REVERSED_SUFFIX
  ) {
    colorRampReversedParam = true;
    colorRampParam = colorRampRawParam.slice(0, -1);
  }

  // Parse palette data
  const paletteKeyParam = urlParams.get(UrlParam.PALETTE_KEY);
  const paletteStringParam = urlParams.get(UrlParam.PALETTE);
  const defaultPalette = KNOWN_CATEGORICAL_PALETTES.get(DEFAULT_CATEGORICAL_PALETTE_KEY)!;

  let categoricalPalette: Color[] | undefined = undefined;
  if (paletteKeyParam) {
    // Use key if provided
    categoricalPalette = KNOWN_CATEGORICAL_PALETTES.get(paletteKeyParam)?.colors || defaultPalette.colors;
  } else if (paletteStringParam) {
    // Parse into color objects
    const hexColors: ColorRepresentation[] = paletteStringParam
      .split("-")
      .map((hex) => "#" + hex) as ColorRepresentation[];
    if (hexColors.length < MAX_FEATURE_CATEGORIES) {
      // backfill extra colors to meet max length using default palette
      hexColors.push(...defaultPalette.colorStops.slice(hexColors.length));
    }
    categoricalPalette = hexColors.map((hex) => new Color(hex));
  }

  const config = deserializeViewerConfig(urlParams);
  const selectedBackdropKey = decodePossiblyNullString(urlParams.get(UrlParam.BACKDROP_KEY)) ?? undefined;
  const scatterPlotConfig = deserializeScatterPlotConfig(urlParams);

  // Remove undefined entries from the object for a cleaner return value
  return removeUndefinedProperties({
    collection: collectionParam,
    dataset: datasetParam,
    feature: featureParam,
    track: trackParam,
    time: timeParam,
    thresholds: thresholdsParam,
    range: rangeParam,
    colorRampKey: colorRampParam,
    colorRampReversed: colorRampReversedParam,
    categoricalPalette,
    config,
    selectedBackdropKey,
    scatterPlotConfig,
  });
}
