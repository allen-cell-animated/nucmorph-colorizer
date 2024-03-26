import { describe, expect, it } from "vitest";

import { FeatureThreshold, ThresholdType } from "../src/colorizer/types";
import { getKeyFromName, validateThresholds } from "../src/colorizer/utils/data_utils";

import { makeMockDataset } from "./Dataset.test";

describe("data_utils", () => {
  describe("getKeyFromName", () => {
    it("handles empty strings", () => {
      expect(getKeyFromName("")).toBe("");
    });

    it("allows alphanumeric and underscore characters", () => {
      expect(getKeyFromName("a")).toBe("a");
      expect(getKeyFromName("_")).toBe("_");
      expect(getKeyFromName("az09")).toBe("az09");
      expect(getKeyFromName("a_b_c")).toBe("a_b_c");
      expect(getKeyFromName("abc_123")).toBe("abc_123");
    });

    it("sets alphabetic characters to lowercase", () => {
      expect(getKeyFromName("A")).toBe("a");
      expect(getKeyFromName("Z")).toBe("z");
      expect(getKeyFromName("ABCDEFG")).toBe("abcdefg");
    });

    it("replaces non-alphanumeric characters with underscores", () => {
      expect(getKeyFromName("+")).toBe("_");
      expect(getKeyFromName("...")).toBe("___");
      expect(getKeyFromName("Some Name (a)")).toBe("some_name__a_");
      expect(getKeyFromName("&Another Name%")).toBe("_another_name_");
    });
  });

  describe("validateThresholds", () => {
    it("replaces feature names with keys", async () => {
      const dataset = await makeMockDataset({
        frames: ["frame0.json"],
        features: [
          { name: "Feature A", key: "feature_a", data: "feature1.json", units: "", type: "discrete" },
          { name: "MY FEATURE B", key: "feature_b", data: "feature2.json", units: "", type: "discrete" },
          {
            name: "My Feature C",
            key: "feature_c",
            data: "feature3.json",
            units: "b",
            type: "continuous",
            categories: ["1", "2", "3"],
          },
        ],
      });

      const existingThresholds: FeatureThreshold[] = [
        {
          featureKey: "Feature A",
          units: "",
          type: ThresholdType.NUMERIC,
          min: 0,
          max: 10,
        },
        {
          featureKey: "MY FEATURE B",
          units: "",
          type: ThresholdType.NUMERIC,
          min: 0,
          max: 10,
        },
        {
          featureKey: "My Feature C",
          units: "will_not_match_unit",
          type: ThresholdType.CATEGORICAL,
          enabledCategories: [true, false, false],
        },
      ];

      const newThresholds = validateThresholds(dataset, existingThresholds);

      expect(newThresholds).to.deep.equal([
        {
          featureKey: "feature_a",
          units: "",
          type: ThresholdType.NUMERIC,
          min: 0,
          max: 10,
        },
        {
          featureKey: "feature_b",
          units: "",
          type: ThresholdType.NUMERIC,
          min: 0,
          max: 10,
        },
        // Ignores features that don't match the units of the dataset's feature
        {
          featureKey: "My Feature C",
          units: "will_not_match_unit",
          type: ThresholdType.CATEGORICAL,
          enabledCategories: [true, false, false],
        },
      ]);
    });
  });
});
