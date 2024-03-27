import { MAX_FEATURE_CATEGORIES } from "../../constants";
import { ColorRampData } from "../colors/color_ramps";
import { FeatureThreshold, isThresholdCategorical, isThresholdNumeric, ThresholdType } from "../types";

import ColorRamp from "../ColorRamp";
import Dataset, { FeatureType } from "../Dataset";

/**
 * Generates a find function for a FeatureThreshold, matching on feature name and unit.
 * @param featureKey String feature key to match on.
 * @param unit String unit to match on.
 * @returns a lambda function that can be passed into `Array.find` for an array of FeatureThreshold.
 * @example
 * ```
 * const featureThresholds = [...]
 * const matchThreshold = featureThresholds.find(thresholdMatchFinder("Temperature", "°C"));
 * ```
 */
export function thresholdMatchFinder(featureKey: string, units: string): (threshold: FeatureThreshold) => boolean {
  return (threshold: FeatureThreshold) => threshold.featureKey === featureKey && threshold.units === units;
}

/**
 * Convenience method for getting a single ramp from a map of strings to ramps, optionally reversing it.
 */
export function getColorMap(colorRampData: Map<string, ColorRampData>, key: string, reversed = false): ColorRamp {
  const colorRamp = colorRampData.get(key)?.colorRamp;
  if (!colorRamp) {
    throw new Error("Could not find data for color ramp '" + key + "'");
  }
  return colorRamp && reversed ? colorRamp.reverse() : colorRamp;
}

/**
 * Validates the thresholds against the dataset. If the threshold's feature is present but the wrong type, it is updated.
 * This is most likely to happen when datasets have different types for the same feature key, or if thresholds are loaded from
 * an outdated URL. Also changes feature names to keys if they are present in the dataset for backwards-compatibility.
 *
 * @param dataset The dataset to validate thresholds against.
 * @param thresholds An array of `FeatureThresholds` to validate.
 * @returns a new array of thresholds, with any categorical thresholds converted to numeric thresholds if the feature is numeric
 * and vice-versa.
 */
export function validateThresholds(dataset: Dataset, thresholds: FeatureThreshold[]): FeatureThreshold[] {
  // Validate feature data for each threshold. If the threshold is the wrong type, update it.
  const newThresholds: FeatureThreshold[] = [];

  for (const threshold of thresholds) {
    // Under the old URL schema, `featureKey` may be a name. Convert it to a key if a matching feature exists in the dataset.
    // Note that units will also need to match for the threshold to be valid for this dataset.
    let featureKey = threshold.featureKey;
    const matchedFeatureKey = dataset.findFeatureByKeyOrName(threshold.featureKey);
    if (matchedFeatureKey !== undefined) {
      featureKey = matchedFeatureKey;
    }

    const featureData = dataset.getFeatureData(featureKey);
    const isInDataset = featureData && featureData.units === threshold.units;

    if (isInDataset) {
      // Threshold key + unit matches, so update feature key just in case it was a name
      threshold.featureKey = featureKey;
    }

    if (isInDataset && featureData.type === FeatureType.CATEGORICAL && isThresholdNumeric(threshold)) {
      // Threshold is not categorical but the feature is.
      // Convert the threshold to categorical.

      // This is important for historical reasons, because older versions of the app used to only store features as numeric
      // thresholds. This would cause categorical features loaded from the URL to be incorrectly shown on the UI.
      newThresholds.push({
        featureKey: featureKey,
        units: threshold.units,
        type: ThresholdType.CATEGORICAL,
        enabledCategories: Array(MAX_FEATURE_CATEGORIES).fill(true),
      });
    } else if (isInDataset && featureData.type !== FeatureType.CATEGORICAL && isThresholdCategorical(threshold)) {
      // Threshold is categorical but the feature is not.
      // Convert to numeric threshold instead.
      newThresholds.push({
        featureKey: featureKey,
        units: threshold.units,
        type: ThresholdType.NUMERIC,
        min: featureData.min,
        max: featureData.max,
      });
    } else {
      // Keep existing threshold
      newThresholds.push(threshold);
    }
  }
  return newThresholds;
}

/** Returns whether a feature value is inside the range of a threshold. */
export function isValueWithinThreshold(value: number, threshold: FeatureThreshold): boolean {
  if (isThresholdNumeric(threshold)) {
    return value >= threshold.min && value <= threshold.max;
  } else {
    return threshold.enabledCategories[value];
  }
}

/**
 * Returns a Uint8 array look-up table indexed by object ID, storing whether that object ID is in range of
 * the given thresholds (=1) or not (=0).
 * @param {Dataset} dataset A valid Dataset object.
 * @param {FeatureThreshold[]} thresholds Array of feature thresholds, which match agaisnt the feature key and unit.
 * If a feature key cannot be found in the dataset, it will be ignored.
 * @returns A Uint8Array, with a length equal to the number of objects in the dataset.
 * For each object ID `i`, `inRangeIds[i]` will be 1 if the object is in range of the thresholds
 * and 0 if it is not.
 */
export function getInRangeLUT(dataset: Dataset, thresholds: FeatureThreshold[]): Uint8Array {
  // TODO: Optimize memory by using a true boolean array?
  // TODO: If optimizing, use fuse operation via shader.
  const inRangeIds = new Uint8Array(dataset.numObjects);

  // Ignore thresholds with features that don't exist in this dataset or whose units don't match
  const validThresholds = thresholds.filter((threshold) => {
    const featureData = dataset.getFeatureData(threshold.featureKey);
    return featureData && featureData.units === threshold.units;
  });

  for (let id = 0; id < dataset.numObjects; id++) {
    inRangeIds[id] = 1;
    for (let thresholdIdx = 0; thresholdIdx < validThresholds.length; thresholdIdx++) {
      const threshold = validThresholds[thresholdIdx];
      const featureData = dataset.getFeatureData(threshold.featureKey);
      if (featureData && !isValueWithinThreshold(featureData.data[id], threshold)) {
        inRangeIds[id] = 0;
        break;
      }
    }
  }
  return inRangeIds;
}

/**
 * Sanitizes a string name to a key for internal use. Replaces all non-alphanumeric characters with underscores,
 * and converts the string to lowercase.
 */
export function getKeyFromName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_");
}
