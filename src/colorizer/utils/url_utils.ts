// Typescript doesn't recognize RequestInit
/* global RequestInit */

import { DEFAULT_COLLECTION_FILENAME, DEFAULT_COLLECTION_PATH } from "../../constants";
import { FeatureThreshold } from "../ColorizeCanvas";
import { numberToStringDecimal } from "./math_utils";

const URL_PARAM_TRACK = "track";
const URL_PARAM_DATASET = "dataset";
const URL_PARAM_FEATURE = "feature";
const URL_PARAM_TIME = "t";
const URL_PARAM_COLLECTION = "collection";
// TODO: Make thresholds/filters language consistent. Requires talking with users/UX!
const URL_PARAM_THRESHOLDS = "thresholds";
const URL_PARAM_RANGE = "range";

export type UrlParams = {
  collection: string;
  dataset: string;
  feature: string;
  track: number;
  time: number;
  // TODO: bad code smell for url params to be aware of this type
  thresholds: FeatureThreshold[];
  range: [number, number];
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
  const controller = new AbortController();
  const signal = controller.signal;
  // If the fetch finishes before the timeout completes, clear the timeout.
  // Note: It's ok even if the timeout still triggers, because the fetch promise is already resolved (settled) and
  // won't change even if the AbortController signals for a promise rejection.
  const timeoutId = setTimeout(() => controller.abort, timeoutMs);
  const fetchPromise = fetch(url, { signal: signal, ...options });
  fetchPromise.then(
    // clear timeout if resolved or rejected
    () => clearTimeout(timeoutId),
    () => clearTimeout(timeoutId)
  );
  return fetchPromise;
}

/**
 * Creates a string of parameters that can be appended onto the base URL as metadata.
 *
 * @param state: An object matching any of the properties of `UrlParams`.
 * - `collection`: string path to the collection. Ignores paths matching the default collection address.
 * - `dataset`: string name or URL of the dataset.
 * - `feature`: string name of the feature.
 * - `track`: integer track number.
 * - `time`: integer frame number.
 * - `thresholds`: array of feature threshold.
 * - `range`: array of two numbers, representing the min and max of the color map range.
 *
 * @returns
 * - If no parameters are present or valid, returns an empty string.
 * - Else, returns a string of URL parameters that can be appended to the URL directly (ex: `?collection=<some_url>&time=23`).
 */
export function stateToUrlQueryString(state: Partial<UrlParams>): string {
  // arguments as more data gets stored to the URL.

  // Get parameters, ignoring null/empty values
  const includedParameters: string[] = [];

  // Don't include collection parameter in URL if it matches the default.
  if (
    state.collection &&
    state.collection !== DEFAULT_COLLECTION_PATH &&
    state.collection !== DEFAULT_COLLECTION_PATH + "/" + DEFAULT_COLLECTION_FILENAME
  ) {
    includedParameters.push(`${URL_PARAM_COLLECTION}=${encodeURIComponent(state.collection)}`);
  }
  if (state.dataset) {
    includedParameters.push(`${URL_PARAM_DATASET}=${encodeURIComponent(state.dataset)}`);
  }
  if (state.feature) {
    includedParameters.push(`${URL_PARAM_FEATURE}=${encodeURIComponent(state.feature)}`);
  }
  if (state.track !== undefined) {
    includedParameters.push(`${URL_PARAM_TRACK}=${state.track}`);
  }
  if (state.time !== undefined) {
    includedParameters.push(`${URL_PARAM_TIME}=${state.time}`);
  }
  if (state.thresholds && state.thresholds.length > 0) {
    // featureName is encoded in case it contains special characters (":" or ",")
    // TODO: Is there a better character separator I can use here? ":" and "," are reserved characters in URLs.
    const thresholdsString = state.thresholds
      .map((threshold) => {
        const featureName = encodeURIComponent(threshold.featureName);
        const min = numberToStringDecimal(threshold.min, 3);
        const max = numberToStringDecimal(threshold.max, 3);
        return `${featureName}:${min}:${max}`;
      })
      .join(",");
    includedParameters.push(`${URL_PARAM_THRESHOLDS}=${encodeURIComponent(thresholdsString)}`);
  }
  if (state.range && state.range.length === 2) {
    const rangeString = numberToStringDecimal(state.range[0], 3) + "," + numberToStringDecimal(state.range[1], 3);
    includedParameters.push(`${URL_PARAM_RANGE}=${encodeURIComponent(rangeString)}`);
  }

  // If parameters present, join with URL syntax and push into the URL
  return includedParameters.length > 0 ? "?" + includedParameters.join("&") : "";
}

/**
 * Replaces the current URL in the browser history with a new one, made by appending
 * the urlParams to the base URL.
 * @param urlParams A string of parameters that can be appended to the base URL.
 */
export function updateUrl(urlParams: string): void {
  // Use replaceState rather than pushState, because otherwise every frame will be a unique
  // URL in the browser history
  window.history.replaceState(null, document.title, urlParams);
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
 * Decodes strings using `decodeURIComponent`, handling null inputs.
 */
function decodePossiblyNullString(input: string | null): string | null {
  return input === null ? null : decodeURIComponent(input);
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
  return input.trim();
}

/**
 * Loads parameters from the current window URL.
 * @returns An object with a dataset, feature, track, and time parameters.
 * The parameters are undefined if no parameter was found in the URL, or if
 * it could not be parsed.
 */
export function loadParamsFromUrl(): Partial<UrlParams> {
  // Get params from URL and load, with default fallbacks.
  const queryString = window.location.search;
  return loadParamsFromUrlQueryString(queryString);
}

function removeUndefinedProperties<T>(object: T): Partial<T> {
  const ret: Partial<T> = {};
  for (const key in object) {
    if (object[key] !== undefined) {
      ret[key] = object[key];
    }
  }
  return ret;
}

export function loadParamsFromUrlQueryString(queryString: string): Partial<UrlParams> {
  // NOTE: URLSearchParams automatically applies one level of URI decoding.
  const urlParams = new URLSearchParams(queryString);

  const base10Radix = 10; // required for parseInt
  const collectionParam = urlParams.get(URL_PARAM_COLLECTION) ?? undefined;
  const datasetParam = urlParams.get(URL_PARAM_DATASET) ?? undefined;
  const featureParam = urlParams.get(URL_PARAM_FEATURE) ?? undefined;
  const trackParam = urlParams.get(URL_PARAM_TRACK)
    ? parseInt(urlParams.get(URL_PARAM_TRACK)!, base10Radix)
    : undefined;
  // This assumes there are no negative timestamps in the dataset
  const timeParam = urlParams.get(URL_PARAM_TIME) ? parseInt(urlParams.get(URL_PARAM_TIME)!, base10Radix) : undefined;

  // Parse and validate thresholds
  let thresholdsParam: FeatureThreshold[] = [];
  const rawThresholdParam = urlParams.get(URL_PARAM_THRESHOLDS);
  if (rawThresholdParam) {
    // Thresholds are separated by commas, and are structured as:
    // {name (encoded)}:{min}:{max}
    const rawThresholds = rawThresholdParam.split(",");
    thresholdsParam = rawThresholds.map((rawThreshold) => {
      const [rawFeatureName, min, max] = rawThreshold.split(":");
      return { featureName: decodeURIComponent(rawFeatureName), min: parseFloat(min), max: parseFloat(max) };
    });
  }

  let rangeParam: [number, number] | undefined = undefined;
  const rawRangeParam = decodePossiblyNullString(urlParams.get(URL_PARAM_RANGE));
  if (rawRangeParam) {
    const [min, max] = rawRangeParam.split(",");
    rangeParam = [parseFloat(min), parseFloat(max)];
  }

  // Remove undefined entries from the object for a cleaner return value
  return removeUndefinedProperties({
    collection: collectionParam ?? undefined,
    dataset: datasetParam ?? undefined,
    feature: featureParam ?? undefined,
    track: trackParam,
    time: timeParam,
    thresholds: thresholdsParam.length > 0 ? thresholdsParam : undefined,
    range: rangeParam,
  });
}
