import { Color } from "three";

import { DrawMode, ThresholdType } from "../colorizer/types";
import { ProjectEntry } from "../types";

export const landingPageContent: ProjectEntry[] = [
  {
    name: "NucMorph dataset name which usually is a rather long name so may wrap to two lines",
    description:
      "Introductory explanatory text about the dataset(s) and anything a user should know before opening in app. This should ideally only be a couple of sentences.",
    publicationLink: new URL("https://www.google.com"),
    publicationName:
      "This is the name of the associated publication that the user can click to open in a new tab (Publisher name, mm/dd/yyyy)",
    loadParams: {
      collection: "https://dev-aics-dtp-001.int.allencell.org/dan-data/colorizer/data/collection.json",
      dataset: "Mama Bear",
      feature: "volume",
    },
    inReview: true,
  },
  {
    name: "This is a project name in the case of multiple datasets belonging to a single project/publication",
    description:
      "Introductory explanatory text about the dataset(s) and anything a user should know before opening in app. This should ideally only be a couple of sentences.",
    datasets: [
      {
        name: "This is a dataset with a semi-long name",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {
          collection: "https://dev-aics-dtp-001.int.allencell.org/dan-data/colorizer/data/collection.json",
          dataset: "Mama Bear",
          feature: "height",
          range: [0.54, 9.452],
          colorRampKey: "esri-mentone_beach",
          time: 154,
        },
      },
      {
        name: "This is a dataset with a semi-long name",
        description: "This is a long description about this particular dataset. 2 lines at most.",
        loadParams: {
          collection: "https://dev-aics-dtp-001.int.allencell.org/dan-data/colorizer/data/collection.json",
          dataset: "Goldilocks",
          feature: "height",
          range: [1.084, 8.156],
          colorRampKey: "esri-blue_red_8",
          time: 446,
        },
      },
      {
        name: "This is a dataset with a semi-long name",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {
          collection: "https://dev-aics-dtp-001.int.allencell.org/dan-data/colorizer/data/collection.json",
          dataset: "Baby Bear",
          feature: "height",
          range: [0.54, 8.895],
          colorRampKey: "esri-green_brown_1",
          time: 397,
          thresholds: [
            {
              featureKey: "volume",
              type: ThresholdType.NUMERIC,
              units: "µm³",
              min: 649.121,
              max: 2457.944,
            },
          ],
          config: {
            outOfRangeDrawSettings: {
              mode: DrawMode.USE_COLOR,
              color: new Color("#858585"),
            },
          },
        },
      },
    ],
  },
  {
    name: "This is a project name in the case of multiple datasets belonging to a single project/publication",
    description:
      "Introductory explanatory text about the dataset(s) and anything a user should know before opening in app. This should ideally only be a couple of sentences.",
    datasets: [
      {
        name: "This is a dataset with a semi-long name",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {},
      },
      {
        name: "This is a dataset with a semi-long name",
        description:
          "This is a long description about this particular dataset. 2 lines at most, but it has extra lines, so the entire section should wrap.",
        loadParams: {},
      },
    ],
  },
  {
    name: "This is a project name in the case of multiple datasets belonging to a single project/publication",
    description:
      "Introductory explanatory text about the dataset(s) and anything a user should know before opening in app. This should ideally only be a couple of sentences.",
    publicationLink: new URL("https://www.google.com"),
    publicationName:
      "This is the name of the associated publication that the user can click to open in a new tab (Publisher name, mm/dd/yyyy)",
    datasets: [
      {
        name: "This is a dataset with a semi-long name",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {},
      },
      {
        name: "This is a dataset with a semi-long name",
        description:
          "This is a long description about this particular dataset. 2 lines at most, but it has extra lines, so the entire section should wrap.",
        loadParams: {},
      },
      {
        name: "This is a dataset with a longer name than the other elements, which should cause it to wrap",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {},
      },
      {
        name: "This is a dataset with a longer name than the other elements, which should cause it to wrap",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {},
      },
      {
        name: "This is a dataset with a longer name than the other elements, which should cause it to wrap",
        description: "This is a short description about this particular dataset. 2 lines at most.",
        loadParams: {},
      },
    ],
  },
];
