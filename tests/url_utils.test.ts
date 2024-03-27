import { Color, ColorRepresentation } from "three";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORICAL_PALETTE_KEY, KNOWN_CATEGORICAL_PALETTES, KNOWN_COLOR_RAMPS } from "../src/colorizer";
import {
  defaultViewerConfig,
  DrawMode,
  DrawSettings,
  PlotRangeType,
  TabType,
  ThresholdType,
} from "../src/colorizer/types";
import {
  isAllenPath,
  isHexColor,
  isJson,
  isUrl,
  loadFromUrlSearchParams,
  paramsToUrlQueryString,
  UrlParams,
} from "../src/colorizer/utils/url_utils";
import { MAX_FEATURE_CATEGORIES } from "../src/constants";

function padCategories(categories: boolean[]): boolean[] {
  const result = [...categories];
  while (result.length < MAX_FEATURE_CATEGORIES) {
    result.push(false);
  }
  return result;
}

const stateWithNonLatinCharacters: [Partial<UrlParams>, string] = [
  {
    collection: "https://some-url.com/collection.json", // https%3A%2F%2Fsome-url.com%2Fcollection.json
    dataset: "你好世界", // %E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C
    feature: "Привет, мир", // %D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%2C%20%D0%BC%D0%B8%D1%80
  },
  // Expected query string:
  "?collection=https%3A%2F%2Fsome-url.com%2Fcollection.json" +
    "&dataset=%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C" +
    "&feature=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%2C%20%D0%BC%D0%B8%D1%80",
];

describe("isUrl", () => {
  it("Can differentiate URLs", () => {
    expect(isUrl("http://some-url.com/")).to.be.true;
    expect(isUrl("https://some-url.com/")).to.be.true;

    expect(isUrl("//resources/some/resource/path")).to.be.true;

    expect(isUrl("C:/Users/http://")).to.be.false;
    expect(isUrl("file.json")).to.be.false;
    expect(isUrl("notaurl")).to.be.false;
  });
});

describe("isJson", () => {
  it("Can differentiate JSONs", () => {
    expect(isJson("file.json")).to.be.true;
    expect(isJson("file")).to.be.false;

    expect(isJson("https://some-url.com/directory/a.json")).to.be.true;
    expect(isJson("https://some-url.com/directory.json/some/folder")).to.be.false;
  });
});

describe("paramsToUrlQueryString", () => {
  it("Handles null/undefined values", () => {
    const result = paramsToUrlQueryString({});
    expect(result).to.be.empty;
  });

  it("Encodes URI components", () => {
    const result = paramsToUrlQueryString(stateWithNonLatinCharacters[0]);
    // The dataset and feature say "Hello World" in Mandarin and Russian in case you're curious.
    expect(result).to.equal(stateWithNonLatinCharacters[1]);
  });
});

describe("loadParamsFromUrlQueryString", () => {
  it("Handles empty query strings", () => {
    const result = loadFromUrlSearchParams(new URLSearchParams(""));
    expect(result).to.deep.equal({});
  });
});

describe("isAllenPath", () => {
  it("Detects allen paths correctly", () => {
    expect(isAllenPath("/allen/some/resource")).to.be.true;
    expect(isAllenPath("/allen/another/resource")).to.be.true;
    expect(isAllenPath("/not-allen/")).to.be.false;
    expect(isAllenPath("/some-other-resource/allen/")).to.be.false;
  });

  it("Ignores URLs", () => {
    expect(isAllenPath("https://some-website.com/allen/another/resource")).to.be.false;
    expect(isAllenPath("http://allen/some-website.com")).to.be.false;
  });

  it("Normalizes slashes", () => {
    expect(isAllenPath("\\allen\\some-resource\\path.json")).to.be.true;
    expect(isAllenPath("\\\\allen\\\\some-resource\\\\path.json")).to.be.true;
    expect(isAllenPath("/allen//some-resource////path.json")).to.be.true;
    expect(isAllenPath("//allen//some-resource////path.json")).to.be.true;
  });
});

describe("Loading + saving from URL query strings", () => {
  it("Encodes + Decodes URL strings", () => {
    const originalParams = stateWithNonLatinCharacters[0];
    const queryString = paramsToUrlQueryString(originalParams);
    expect(queryString).equals(stateWithNonLatinCharacters[1]);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams).deep.equals(originalParams);
  });

  it("Saves and retrieves URL params correctly", () => {
    // This will need to be updated for any new URL params.
    // The use of `Required` makes sure that we don't forget to update this test :)
    const originalParams: Required<UrlParams> = {
      collection: "collection",
      dataset: "dataset",
      feature: "feature",
      track: 25,
      time: 14,
      thresholds: [
        { featureKey: "f1", units: "m", type: ThresholdType.NUMERIC, min: 0, max: 0 },
        { featureKey: "f2", units: "um", type: ThresholdType.NUMERIC, min: NaN, max: NaN },
        { featureKey: "f3", units: "km", type: ThresholdType.NUMERIC, min: 0, max: 1 },
        { featureKey: "f4", units: "mm", type: ThresholdType.NUMERIC, min: 0.501, max: 1000.485 },
        {
          featureKey: "f5",
          units: "",
          type: ThresholdType.CATEGORICAL,
          enabledCategories: [true, true, true, true, true, true, true, true, true, true, true, true],
        },
        {
          featureKey: "f6",
          units: "",
          type: ThresholdType.CATEGORICAL,
          enabledCategories: [true, false, false, false, true, false, false, false, false, false, false, false],
        },
      ],
      range: [21.433, 89.4],
      colorRampKey: "myMap-1",
      colorRampReversed: true,
      categoricalPalette: KNOWN_CATEGORICAL_PALETTES.get(DEFAULT_CATEGORICAL_PALETTE_KEY)!.colors,
      config: {
        showTrackPath: true,
        showScaleBar: true,
        showTimestamp: false,
        keepRangeBetweenDatasets: true,
        backdropBrightness: 75,
        backdropSaturation: 50,
        objectOpacity: 25,
        openTab: TabType.FILTERS,
        outOfRangeDrawSettings: { mode: DrawMode.HIDE, color: new Color("#ff0000") } as DrawSettings,
        outlierDrawSettings: { mode: DrawMode.USE_COLOR, color: new Color("#00ff00") } as DrawSettings,
      },
      selectedBackdropKey: "some_backdrop",
      scatterPlotConfig: {
        xAxis: "x axis name",
        yAxis: "y axis name",
        rangeType: PlotRangeType.ALL_TIME,
      },
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString =
      "?collection=collection&dataset=dataset&feature=feature&track=25&t=14&filters=f1%3Am%3A0%3A0%2Cf2%3Aum%3ANaN%3ANaN%2Cf3%3Akm%3A0%3A1%2Cf4%3Amm%3A0.501%3A1000.485%2Cf5%3A%3Afff%2Cf6%3A%3A11&range=21.433%2C89.400&color=myMap-1!&palette-key=adobe&bg-sat=50&bg-brightness=75&fg-alpha=25&outlier-color=00ff00&outlier-mode=1&filter-color=ff0000&filter-mode=0&tab=filters&scalebar=1&timestamp=0&path=1&keep-range=1&bg-key=some_backdrop&scatter-range=all&scatter-x=x%20axis%20name&scatter-y=y%20axis%20name";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams).deep.equals(originalParams);
  });

  it("Handles feature threshold names with nonstandard characters", () => {
    const originalParams: Partial<UrlParams> = {
      thresholds: [
        { featureKey: "feature,,,", units: ",m,", type: ThresholdType.NUMERIC, min: 0, max: 1 },
        { featureKey: "(feature)", units: "(m)", type: ThresholdType.NUMERIC, min: 0, max: 1 },
        { featureKey: "feat:ure", units: ":m", type: ThresholdType.NUMERIC, min: 0, max: 1 },
        {
          featureKey: "0.0%",
          units: "m&m's",
          type: ThresholdType.CATEGORICAL,
          enabledCategories: padCategories([true, false, false]),
        },
      ],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString =
      "?filters=feature%252C%252C%252C%3A%252Cm%252C%3A0%3A1%2C(feature)%3A(m)%3A0%3A1%2Cfeat%253Aure%3A%253Am%3A0%3A1%2C0.0%2525%3Am%2526m's%3A1";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams).deep.equals(originalParams);
  });

  it("Enforces min/max on range and thresholds", () => {
    const originalParams: Partial<UrlParams> = {
      thresholds: [
        { featureKey: "feature1", units: "m", type: ThresholdType.NUMERIC, min: 1, max: 0 },
        { featureKey: "feature2", units: "m", type: ThresholdType.NUMERIC, min: 12, max: -34 },
        { featureKey: "feature3", units: "m", type: ThresholdType.NUMERIC, min: 0.5, max: 0.25 },
      ],
      range: [1, 0],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString =
      "?filters=feature1%3Am%3A1%3A0%2Cfeature2%3Am%3A12%3A-34%2Cfeature3%3Am%3A0.500%3A0.250&range=1%2C0";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));

    expect(parsedParams.thresholds).deep.equals([
      { featureKey: "feature1", units: "m", type: ThresholdType.NUMERIC, min: 0, max: 1 },
      { featureKey: "feature2", units: "m", type: ThresholdType.NUMERIC, min: -34, max: 12 },
      { featureKey: "feature3", units: "m", type: ThresholdType.NUMERIC, min: 0.25, max: 0.5 },
    ]);
    expect(parsedParams.range).deep.equals([0, 1]);
  });

  it("Handles empty feature thresholds", () => {
    const originalParams: Partial<UrlParams> = {
      thresholds: [{ featureKey: "feature1", units: "", type: ThresholdType.NUMERIC, min: 0, max: 1 }],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString = "?filters=feature1%3A%3A0%3A1";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams.thresholds).deep.equals(originalParams.thresholds);
  });

  it("Handles zero values for numeric parameters", () => {
    const originalParams: Partial<UrlParams> = {
      time: 0,
      track: 0,
      range: [0, 0],
      thresholds: [{ featureKey: "feature", units: "", type: ThresholdType.NUMERIC, min: 0, max: 0 }],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString = "?track=0&t=0&filters=feature%3A%3A0%3A0&range=0%2C0";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams).deep.equals(originalParams);
  });

  it("Handles less than the maximum expected categories", () => {
    const originalParams: Partial<UrlParams> = {
      thresholds: [{ featureKey: "feature", units: "", type: ThresholdType.CATEGORICAL, enabledCategories: [true] }],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString = "?filters=feature%3A%3A1";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams.thresholds).deep.equals([
      {
        featureKey: "feature",
        units: "",
        type: ThresholdType.CATEGORICAL,
        enabledCategories: padCategories([true]),
      },
    ]);
  });

  it("Handles more than the maximum expected categories", () => {
    const thresholds = padCategories([true, true]);
    thresholds.push(true); // Add an extra threshold. This should be ignored
    const originalParams: Partial<UrlParams> = {
      thresholds: [
        { featureKey: "feature", units: "", type: ThresholdType.CATEGORICAL, enabledCategories: thresholds },
      ],
    };
    const queryString = paramsToUrlQueryString(originalParams);
    const expectedQueryString = "?filters=feature%3A%3A1003";
    expect(queryString).equals(expectedQueryString);

    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams.thresholds).deep.equals([
      {
        featureKey: "feature",
        units: "",
        type: ThresholdType.CATEGORICAL,
        enabledCategories: padCategories([true, true]),
      },
    ]);
  });

  it("Handles all color map names", () => {
    // Test all color ramp names to make sure they can be safely sent through the URL.
    for (const key of KNOWN_COLOR_RAMPS.keys()) {
      const params: Partial<UrlParams> = { colorRampKey: key };
      let queryString = paramsToUrlQueryString(params);
      let parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals(params);

      // Reversed
      params.colorRampReversed = true;
      queryString = paramsToUrlQueryString(params);
      parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals(params);
    }
  });

  it("Accepts keys for all palettes", () => {
    for (const data of KNOWN_CATEGORICAL_PALETTES.values()) {
      const params: Partial<UrlParams> = { categoricalPalette: data.colors };
      const queryString = paramsToUrlQueryString(params);

      expect(queryString).to.equal(`?palette-key=${data.key}`);

      const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals(params);
      expect(parsedParams.categoricalPalette).deep.equals(data.colors);
    }
  });

  it("Handles palette colors", () => {
    const hexColors: ColorRepresentation[] = [
      "#000000",
      "#000010",
      "#000020",
      "#000030",
      "#000040",
      "#000050",
      "#000060",
      "#000070",
      "#000080",
      "#000090",
      "#0000a0",
      "#0000b0",
    ];
    const colors = hexColors.map((color) => new Color(color));
    const params: Partial<UrlParams> = { categoricalPalette: colors };
    const queryString = paramsToUrlQueryString(params);
    expect(queryString).equals(
      "?palette=000000-000010-000020-000030-000040-000050-000060-000070-000080-000090-0000a0-0000b0"
    );
    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
    expect(parsedParams).deep.equals(params);
  });

  it("Uses palette key instead of palette array when both are provided", () => {
    const queryString =
      "?palette-key=adobe&palette=000000-ff0000-00ff00-0000ff-000000-ff0000-00ff00-0000ff-000000-ff0000-00ff00-0000ff";
    const expectedParams = {
      categoricalPalette: KNOWN_CATEGORICAL_PALETTES.get("adobe")?.colors,
    };
    expect(loadFromUrlSearchParams(new URLSearchParams(queryString))).deep.equals(expectedParams);
  });

  it("Backfills missing palette colors", () => {
    const hexColors: ColorRepresentation[] = ["#000000", "#000010", "#000020", "#000030"];
    const colors = hexColors.map((color) => new Color(color));

    const params: Partial<UrlParams> = { categoricalPalette: colors };
    const queryString = paramsToUrlQueryString(params);
    expect(queryString).equals("?palette=000000-000010-000020-000030");
    const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));

    const defaultColors = KNOWN_CATEGORICAL_PALETTES.get("adobe")!.colors;
    const expectedColors = [...colors, ...defaultColors.slice(4)];
    expect(parsedParams).deep.equals({ categoricalPalette: expectedColors });
  });

  describe("ViewerConfig", () => {
    it("Handles all tab types", () => {
      for (const tabType of Object.values(TabType)) {
        const params: Partial<UrlParams> = { config: { openTab: tabType } };
        const queryString = paramsToUrlQueryString(params);
        const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
        expect(parsedParams).deep.equals(params);
      }
    });

    it("Keeps backwards-compatibility with existing tab strings", () => {
      // This test will break if the tab strings are ever changed as a warning.
      const knownTabStrings: Record<string, TabType> = {
        filters: TabType.FILTERS,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        track_plot: TabType.TRACK_PLOT,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        scatter_plot: TabType.SCATTER_PLOT,
        settings: TabType.SETTINGS,
      };
      for (const tabString of Object.keys(knownTabStrings)) {
        const expectedTabType = knownTabStrings[tabString];
        const queryString = `?tab=${tabString}`;
        const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
        expect(parsedParams).deep.equals({ config: { openTab: expectedTabType } });
      }
    });

    it("Returns partial configs if values are undefined", () => {
      const params: Partial<UrlParams> = {
        config: {
          showTrackPath: true,
          showScaleBar: false,
        },
      };
      const queryString = paramsToUrlQueryString(params);
      expect(queryString).equals("?scalebar=0&path=1");
      const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals(params);
    });

    it("Uses default DrawSettings colors for malformed or missing color strings", () => {
      const queryString = "?outlier-mode=0&outlier-color=a8d8c8d9&filter-mode=1";
      const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals({
        config: {
          outlierDrawSettings: {
            mode: DrawMode.HIDE,
            color: defaultViewerConfig.outlierDrawSettings.color,
          },
          outOfRangeDrawSettings: {
            mode: DrawMode.USE_COLOR,
            color: defaultViewerConfig.outOfRangeDrawSettings.color,
          },
        },
      });
    });
  });

  describe("scatterPlotConfig", () => {
    it("Ignores null feature names", () => {
      const queryParams: Partial<UrlParams> = {
        scatterPlotConfig: {
          xAxis: null,
          yAxis: "y_axis_name",
          rangeType: PlotRangeType.ALL_TIME,
        },
      };
      const expectedParams: Partial<UrlParams> = {
        scatterPlotConfig: {
          yAxis: "y_axis_name",
          rangeType: PlotRangeType.ALL_TIME,
        },
      };

      const queryString = paramsToUrlQueryString(queryParams);
      const expectedQueryString = "?scatter-range=all&scatter-y=y_axis_name";
      expect(queryString).equals(expectedQueryString);
      const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals(expectedParams);
    });

    it("Handles non-standard feature names", () => {
      const featureNames = [
        "feature,,,",
        "(feature)",
        "feat:u:re",
        "Feature",
        "fe@tμre",
        "feature feature feature feature",
      ];
      for (const name of featureNames) {
        const expectedEncodedName = encodeURIComponent(name);
        const queryParams: Partial<UrlParams> = {
          scatterPlotConfig: {
            xAxis: name,
            yAxis: name,
          },
        };
        const expectedQueryString = `?scatter-x=${expectedEncodedName}&scatter-y=${expectedEncodedName}`;
        const queryString = paramsToUrlQueryString(queryParams);
        expect(queryString).equals(expectedQueryString);
        const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
        expect(parsedParams).deep.equals(queryParams);
      }
    });

    it("Handles all range enum values", () => {
      for (const rangeType of Object.values(PlotRangeType)) {
        const queryParams = { scatterPlotConfig: { rangeType } };
        const queryString = paramsToUrlQueryString(queryParams);
        const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
        expect(parsedParams).deep.equals(queryParams);
      }
    });

    it("Skips bad range enum types", () => {
      const queryString = "?scatter-range=bad_value";
      const parsedParams = loadFromUrlSearchParams(new URLSearchParams(queryString));
      expect(parsedParams).deep.equals({});
    });
  });

  describe("isHexColor", () => {
    it("Handles 3 character hex strings", () => {
      expect(isHexColor("#000")).to.be.true;
      expect(isHexColor("#fff")).to.be.true;
      expect(isHexColor("#ccc")).to.be.true;
    });

    it("Handles 6-character hex strings", () => {
      expect(isHexColor("#000000")).to.be.true;
      expect(isHexColor("#ffffff")).to.be.true;
      expect(isHexColor("#a0c8b0")).to.be.true;
    });

    it("Catches non-hex values", () => {
      expect(isHexColor("000000")).to.be.false;
      expect(isHexColor("gggggg")).to.be.false;
      expect(isHexColor("#44")).to.be.false;
      expect(isHexColor("some-bad-value")).to.be.false;
    });

    it("Ignores hex values with alpha", () => {
      expect(isHexColor("#aabbccdd")).to.be.false;
    });
  });
});
