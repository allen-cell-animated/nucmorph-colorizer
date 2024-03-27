import {
  CaretRightOutlined,
  CheckCircleOutlined,
  LinkOutlined,
  PauseOutlined,
  StepBackwardFilled,
  StepForwardFilled,
} from "@ant-design/icons";
import { Checkbox, notification, Slider, Tabs } from "antd";
import { NotificationConfig } from "antd/es/notification/interface";
import React, { ReactElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Location, useLocation, useSearchParams } from "react-router-dom";

import { ColorizeCanvas, Dataset, Track } from "./colorizer";
import {
  DEFAULT_CATEGORICAL_PALETTE_KEY,
  DISPLAY_CATEGORICAL_PALETTE_KEYS,
  KNOWN_CATEGORICAL_PALETTES,
} from "./colorizer/colors/categorical_palettes";
import { DEFAULT_COLOR_RAMP_KEY, DISPLAY_COLOR_RAMP_KEYS, KNOWN_COLOR_RAMPS } from "./colorizer/colors/color_ramps";
import {
  defaultViewerConfig,
  FeatureThreshold,
  getDefaultScatterPlotConfig,
  isThresholdNumeric,
  ScatterPlotConfig,
  TabType,
  ViewerConfig,
} from "./colorizer/types";
import { getColorMap, getInRangeLUT, thresholdMatchFinder, validateThresholds } from "./colorizer/utils/data_utils";
import { numberToStringDecimal } from "./colorizer/utils/math_utils";
import { useConstructor, useDebounce, useRecentCollections } from "./colorizer/utils/react_utils";
import * as urlUtils from "./colorizer/utils/url_utils";
import { DEFAULT_COLLECTION_PATH, DEFAULT_PLAYBACK_FPS } from "./constants";
import { FlexRowAlignCenter } from "./styles/utils";
import { LocationState } from "./types";

import Collection from "./colorizer/Collection";
import { BACKGROUND_ID } from "./colorizer/ColorizeCanvas";
import TimeControls from "./colorizer/TimeControls";
import { AppThemeContext } from "./components/AppStyle";
import TextButton from "./components/Buttons/TextButton";
import CanvasWrapper from "./components/CanvasWrapper";
import CategoricalColorPicker from "./components/CategoricalColorPicker";
import ColorRampDropdown from "./components/Dropdowns/ColorRampDropdown";
import HelpDropdown from "./components/Dropdowns/HelpDropdown";
import SelectionDropdown from "./components/Dropdowns/SelectionDropdown";
import Export from "./components/Export";
import Header from "./components/Header";
import HoverTooltip from "./components/HoverTooltip";
import IconButton from "./components/IconButton";
import LabeledRangeSlider from "./components/LabeledRangeSlider";
import LoadDatasetButton from "./components/LoadDatasetButton";
import PlaybackSpeedControl from "./components/PlaybackSpeedControl";
import SpinBox from "./components/SpinBox";
import { FeatureThresholdsTab, PlotTab, ScatterPlotTab, SettingsTab } from "./components/Tabs";

// TODO: Refactor with styled-components
import styles from "./Viewer.module.css";

function Viewer(): ReactElement {
  // STATE INITIALIZATION /////////////////////////////////////////////////////////
  const theme = useContext(AppThemeContext);
  const location = useLocation();

  const canv = useConstructor(() => {
    const canvas = new ColorizeCanvas();
    canvas.domElement.className = styles.colorizeCanvas;
    return canvas;
  });

  const [collection, setCollection] = useState<Collection | undefined>();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetKey, setDatasetKey] = useState("");
  const [, addRecentCollection] = useRecentCollections();

  const [featureKey, setFeatureKey] = useState("");
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [selectedBackdropKey, setSelectedBackdropKey] = useState<string | null>(null);

  // TODO: Save these settings in local storage
  // Use reducer here in case multiple updates happen simultaneously
  const [config, updateConfig] = useReducer(
    (current: ViewerConfig, newProperties: Partial<ViewerConfig>) => ({ ...current, ...newProperties }),
    defaultViewerConfig
  );
  const [scatterPlotConfig, updateScatterPlotConfig] = useReducer(
    (current: ScatterPlotConfig, newProperties: Partial<ScatterPlotConfig>) => ({ ...current, ...newProperties }),
    getDefaultScatterPlotConfig()
  );

  const [isInitialDatasetLoaded, setIsInitialDatasetLoaded] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(false);

  const colorRampData = KNOWN_COLOR_RAMPS;
  const [colorRampKey, setColorRampKey] = useState(DEFAULT_COLOR_RAMP_KEY);
  const [colorRampReversed, setColorRampReversed] = useState(false);
  const [colorRampMin, setColorRampMin] = useState(0);
  const [colorRampMax, setColorRampMax] = useState(0);

  const [categoricalPalette, setCategoricalPalette] = useState(
    KNOWN_CATEGORICAL_PALETTES.get(DEFAULT_CATEGORICAL_PALETTE_KEY)!.colors
  );

  const [featureThresholds, _setFeatureThresholds] = useState<FeatureThreshold[]>([]);
  const setFeatureThresholds = useCallback(
    // Change the current feature min + max on the color ramp if that feature's threshold moved.
    (newThresholds: FeatureThreshold[]): void => {
      // Check if the current feature is being thresholded on, and if that threshold
      // has changed. If so, snap the current min + max color ramp values so they match the new
      // threshold values.
      const featureData = dataset?.getFeatureData(featureKey);
      if (featureData) {
        const oldThreshold = featureThresholds.find(thresholdMatchFinder(featureKey, featureData.units));
        const newThreshold = newThresholds.find(thresholdMatchFinder(featureKey, featureData.units));

        if (newThreshold && oldThreshold && isThresholdNumeric(newThreshold) && isThresholdNumeric(oldThreshold)) {
          if (newThreshold.min !== oldThreshold.min || newThreshold.max !== oldThreshold.max) {
            setColorRampMin(newThreshold.min);
            setColorRampMax(newThreshold.max);
          }
        }
      }
      _setFeatureThresholds(newThresholds);
    },
    [featureKey, dataset, featureThresholds]
  );
  /** A look-up-table from object ID to whether it is in range (=1) or not (=0) */
  const inRangeLUT = useMemo(() => {
    if (!dataset) {
      return new Uint8Array(0);
    }
    return getInRangeLUT(dataset, featureThresholds);
  }, [dataset, featureThresholds]);

  const [playbackFps, setPlaybackFps] = useState(DEFAULT_PLAYBACK_FPS);

  const [searchParams, setSearchParams] = useSearchParams();
  // Provides a mounting point for Antd's notification component. Otherwise, the notifications
  // are mounted outside of App and don't receive CSS styling variables.
  const notificationContainer = useRef<HTMLDivElement>(null);
  const notificationConfig: NotificationConfig = {
    getContainer: () => notificationContainer.current as HTMLElement,
  };
  const [notificationApi, notificationContextHolder] = notification.useNotification(notificationConfig);

  const [isRecording, setIsRecording] = useState(false);
  const timeControls = useConstructor(() => new TimeControls(canv!, playbackFps));
  // TODO: Move all logic for the time slider into its own component!
  // Flag used to indicate that the slider is currently being dragged while playback is occurring.
  const [isTimeSliderDraggedDuringPlayback, setIsTimeSliderDraggedDuringPlayback] = useState(false);

  useEffect(() => {
    if (timeControls.isPlaying()) {
      setIsTimeSliderDraggedDuringPlayback(false);
    }
  }, [timeControls.isPlaying()]);

  /** The frame selected by the time UI. Changes to frameInput are reflected in
   * canvas after a short delay.
   */
  const [frameInput, setFrameInput] = useState(0);
  const [findTrackInput, setFindTrackInput] = useState("");
  // Prevent jarring jumps in the hover tooltip by using the last non-null value
  const [lastHoveredId, setLastHoveredId] = useState<number | null>(null);
  const [showHoveredId, setShowHoveredId] = useState(false);

  // UTILITY METHODS /////////////////////////////////////////////////////////////

  /**
   * Formats the dataset and collection parameters for use in a URL.
   */
  const getDatasetAndCollectionParam = useCallback((): {
    datasetParam?: string;
    collectionParam?: string;
  } => {
    if (collection?.url === null) {
      // A single dataset was loaded, so there's no collection URL. Use the dataset URL instead.
      return { datasetParam: dataset?.manifestUrl, collectionParam: undefined };
    } else {
      return { datasetParam: datasetKey, collectionParam: collection?.url };
    }
  }, [datasetKey, dataset, collection]);

  /**
   * Get the optional color map feature range parameter for the URL. If the range
   * is the full range of the feature's values (default), return undefined.
   */
  const getRangeParam = useCallback((): [number, number] | undefined => {
    if (!dataset) {
      return undefined;
    }
    // check if current selected feature range matches the default feature range; if so, don't provide
    // a range parameter..
    const featureData = dataset.getFeatureData(featureKey);
    if (featureData) {
      if (featureData.min === colorRampMin && featureData.max === colorRampMax) {
        return undefined;
      }
    }
    return [colorRampMin, colorRampMax];
  }, [colorRampMin, colorRampMax, featureKey, dataset]);

  /**
   * Get a URL query string representing the current collection, dataset, feature, track,
   * and frame information.
   */
  const getUrlParams = useCallback((): string => {
    const { datasetParam, collectionParam } = getDatasetAndCollectionParam();
    const rangeParam = getRangeParam();
    const state: Partial<urlUtils.UrlParams> = {
      collection: collectionParam,
      dataset: datasetParam,
      feature: featureKey,
      track: selectedTrack?.trackId,
      // Ignore time=0 to reduce clutter
      time: currentFrame !== 0 ? currentFrame : undefined,
      thresholds: featureThresholds,
      range: rangeParam,
      colorRampKey: colorRampKey,
      colorRampReversed: colorRampReversed,
      categoricalPalette: categoricalPalette,
      config: config,
      selectedBackdropKey,
      scatterPlotConfig,
    };
    return urlUtils.paramsToUrlQueryString(state);
  }, [
    getDatasetAndCollectionParam,
    getRangeParam,
    featureKey,
    selectedTrack,
    currentFrame,
    featureThresholds,
    colorRampKey,
    colorRampReversed,
    categoricalPalette,
    config,
    selectedBackdropKey,
    scatterPlotConfig,
  ]);

  // Update url whenever the viewer settings change
  // (but not while playing/recording for performance reasons)
  useEffect(() => {
    if (!timeControls.isPlaying() && !isRecording) {
      setSearchParams(getUrlParams(), { replace: true });
    }
  }, [timeControls.isPlaying(), isRecording, getUrlParams]);

  const setFrame = useCallback(
    async (frame: number) => {
      await canv.setFrame(frame);
      setCurrentFrame(frame);
      setFrameInput(frame);
      canv.render();
    },
    [canv]
  );

  const findTrack = useCallback(
    (trackId: number | null, seekToFrame: boolean = true): void => {
      if (trackId === null) {
        setSelectedTrack(null);
        return;
      }

      const newTrack = dataset!.buildTrack(trackId);

      if (newTrack.ids.length < 1) {
        // Check track validity
        return;
      }
      setSelectedTrack(newTrack);
      if (seekToFrame) {
        setFrame(newTrack.times[0]);
      }
      setFindTrackInput("" + trackId);
    },
    [canv, dataset, featureKey, currentFrame]
  );

  /**
   * Attempts to replace the current feature with a new feature from a dataset.
   * If the feature cannot be loaded, returns the old feature key and does nothing.
   * @param newDataset the dataset to pull feature data from.
   * @param newFeatureKey the key of the new feature to select.
   * @returns the new feature key if it was successfully found and loaded. Otherwise, returns the old feature key.
   */
  const replaceFeature = useCallback(
    (featureDataset: Dataset, newFeatureKey: string): string => {
      if (!featureDataset?.hasFeatureKey(newFeatureKey)) {
        console.warn("Dataset does not have feature '" + newFeatureKey + "'.");
        return featureKey;
      }
      setFeatureKey(newFeatureKey);
      canv.setFeatureKey(newFeatureKey);
      return newFeatureKey;
    },
    [canv, featureKey]
  );

  /**
   * Resets the color ramp to a default min and max value based on the feature and dataset.
   *
   * If the feature is thresholded, the color ramp will be set to the threshold's min and max.
   * Otherwise, the color ramp will be set to the feature's min and max.
   *
   * (Does nothing if the viewer is configured to keep the range between datasets.)
   */
  const resetColorRampRangeToDefaults = useCallback(
    (featureDataset: Dataset, featureKey: string): void => {
      const featureData = featureDataset.getFeatureData(featureKey);
      if (!config.keepRangeBetweenDatasets && featureData) {
        // Use min/max from threshold if there is a matching one, otherwise use feature min/max
        const threshold = featureThresholds.find(thresholdMatchFinder(featureKey, featureData.units));
        if (threshold && isThresholdNumeric(threshold)) {
          setColorRampMin(threshold.min);
          setColorRampMax(threshold.max);
        } else {
          setColorRampMin(featureData.min);
          setColorRampMax(featureData.max);
        }
      }
    },
    [featureThresholds, config.keepRangeBetweenDatasets]
  );

  // DATASET LOADING ///////////////////////////////////////////////////////
  /**
   * Replaces the current dataset with another loaded dataset. Handles cleanup and state changes.
   * @param newDataset the new Dataset to replace the existing with. If null, does nothing.
   * @param newDatasetKey the key of the new dataset in the Collection.
   * @returns a Promise<void> that resolves when the loading is complete.
   */
  const replaceDataset = useCallback(
    async (newDataset: Dataset | null, newDatasetKey: string): Promise<void> => {
      console.trace("Replacing dataset with " + newDatasetKey + ".");
      // TODO: Change the way flags are handled to prevent flickering during dataset replacement
      setDatasetOpen(false);
      if (newDataset === null) {
        // TODO: Determine with UX what expected behavior should be for bad datasets
        return;
      }

      // Dispose of the old dataset
      if (dataset !== null) {
        dataset.dispose();
      }
      // State updates
      setDataset(newDataset);
      setDatasetKey(newDatasetKey);

      // Only change the feature if there's no equivalent in the new dataset
      let newFeatureKey = featureKey;
      if (!newDataset.hasFeatureKey(newFeatureKey)) {
        // No equivalent, so default to first feature
        newFeatureKey = newDataset.featureKeys[0];
      }
      replaceFeature(newDataset, newFeatureKey);
      resetColorRampRangeToDefaults(newDataset, newFeatureKey);
      setFeatureKey(newFeatureKey);

      await canv.setDataset(newDataset);
      canv.setFeatureKey(newFeatureKey);

      // Clamp frame to new range
      const newFrame = Math.min(currentFrame, canv.getTotalFrames() - 1);
      await setFrame(newFrame);

      setFindTrackInput("");
      if (selectedBackdropKey && !newDataset.hasBackdrop(selectedBackdropKey)) {
        setSelectedBackdropKey(null);
      }
      setSelectedTrack(null);
      setDatasetOpen(true);
      setFeatureThresholds(validateThresholds(newDataset, featureThresholds));
      console.log("Num Items:" + newDataset?.numObjects);
    },
    [
      dataset,
      featureKey,
      canv,
      currentFrame,
      getUrlParams,
      replaceFeature,
      resetColorRampRangeToDefaults,
      featureThresholds,
    ]
  );

  // INITIAL SETUP  ////////////////////////////////////////////////////////////////

  // Only retrieve parameters once, because the URL can be updated by state updates
  // and lose information (like the track, feature, time, etc.) that isn't
  // accessed in the first render.
  const initialUrlParams = useConstructor(() => {
    return urlUtils.loadFromUrlSearchParams(searchParams);
  });

  // Load URL parameters into the state that don't require a dataset to be loaded.
  // This reduces flicker on initial load.
  useEffect(() => {
    // Load the currently selected color ramp info from the URL, if it exists.
    if (initialUrlParams.colorRampKey && colorRampData.has(initialUrlParams.colorRampKey)) {
      setColorRampKey(initialUrlParams.colorRampKey);
    }
    if (initialUrlParams.colorRampReversed) {
      setColorRampReversed(initialUrlParams.colorRampReversed);
    }
    if (initialUrlParams.categoricalPalette) {
      setCategoricalPalette(initialUrlParams.categoricalPalette);
    }
  }, []);

  // Break React rules to prevent a race condition where the initial dataset is reloaded
  // when useEffect gets fired twice. This caused certain URL parameters like time to get
  // lost or reset.
  const isLoadingInitialDataset = useRef<boolean>(false);

  // Attempt to load database and collections data from the URL.
  // This is memoized so that it only runs one time on startup.
  useEffect(() => {
    const loadInitialDataset = async (): Promise<void> => {
      if (isLoadingInitialDataset.current || isInitialDatasetLoaded) {
        return;
      }
      isLoadingInitialDataset.current = true;
      let newCollection: Collection;
      let datasetKey: string;

      const locationHasCollectionAndDataset = (location: Location): boolean => {
        return location.state && "collection" in location.state && "datasetKey" in location.state;
      };

      // Check if we were passed a collection + dataset from the previous page.
      if (locationHasCollectionAndDataset(location)) {
        // Collect from previous page state
        const { collection: stateCollection, datasetKey: stateDatasetKey } = location.state as LocationState;
        datasetKey = stateDatasetKey;
        newCollection = stateCollection;
      } else {
        // Collect from URL
        const collectionUrlParam = initialUrlParams.collection;
        const datasetParam = initialUrlParams.dataset;

        if (datasetParam && urlUtils.isUrl(datasetParam) && !collectionUrlParam) {
          // Dataset is a URL and no collection URL is provided;
          // Make a dummy collection that will include only this dataset
          newCollection = Collection.makeCollectionFromSingleDataset(datasetParam);
          datasetKey = newCollection.getDefaultDatasetKey();
        } else {
          // Try loading the collection, with the default collection as a fallback.
          try {
            newCollection = await Collection.loadCollection(collectionUrlParam || DEFAULT_COLLECTION_PATH);
            datasetKey = datasetParam || newCollection.getDefaultDatasetKey();
          } catch (error) {
            console.error(error);
            notificationApi["error"]({
              message: "Error loading dataset:",
              description: (error as Error).message,
              placement: "bottomLeft",
              duration: 4,
            });
            return;
          }
        }
      }

      setCollection(newCollection);
      const datasetResult = await newCollection.tryLoadDataset(datasetKey);

      if (!datasetResult.loaded) {
        console.error(datasetResult.errorMessage);
        notificationApi["error"]({
          message: "Error loading dataset: ",
          description: datasetResult.errorMessage,
          placement: "bottomLeft",
          duration: 4,
        });
        return;
      }

      // Add the collection to the recent collections list
      addRecentCollection({ url: newCollection.getUrl() });

      // TODO: The new dataset may be null if loading failed. See TODO in replaceDataset about expected behavior.
      if (!isInitialDatasetLoaded) {
        await replaceDataset(datasetResult.dataset, datasetKey);
        setIsInitialDatasetLoaded(true);
      }
      return;
    };
    loadInitialDataset();
  }, []);

  // Load additional properties from the URL, including the time, track, and feature.
  // Run only once after the first dataset has been loaded.
  useEffect(() => {
    if (!isInitialDatasetLoaded) {
      return;
    }
    const setupInitialParameters = async (): Promise<void> => {
      if (initialUrlParams.thresholds) {
        if (dataset) {
          setFeatureThresholds(validateThresholds(dataset, initialUrlParams.thresholds));
        } else {
          setFeatureThresholds(initialUrlParams.thresholds);
        }
      }
      let newFeatureKey = featureKey;
      if (initialUrlParams.feature && dataset) {
        // Load feature (if unset, do nothing because replaceDataset already loads a default)
        newFeatureKey = replaceFeature(dataset, dataset.findFeatureByKeyOrName(initialUrlParams.feature) || featureKey);
      }
      // Range, track, and time setting must be done after the dataset and feature is set.
      if (initialUrlParams.range) {
        setColorRampMin(initialUrlParams.range[0]);
        setColorRampMax(initialUrlParams.range[1]);
      } else {
        // Load default range from dataset for the current feature
        dataset && resetColorRampRangeToDefaults(dataset, newFeatureKey);
      }

      if (initialUrlParams.track && initialUrlParams.track >= 0) {
        // Highlight the track. Seek to start of frame only if time is not defined.
        findTrack(initialUrlParams.track, initialUrlParams.time !== undefined);
      }
      if (initialUrlParams.time && initialUrlParams.time >= 0) {
        // Load time (if unset, defaults to track time or default t=0)
        const newTime = initialUrlParams.time;
        await canv.setFrame(newTime);
        setCurrentFrame(newTime); // Force render
        setFrameInput(newTime);
      }

      const backdropKey = initialUrlParams.selectedBackdropKey;
      if (backdropKey) {
        if (dataset?.hasBackdrop(backdropKey)) {
          setSelectedBackdropKey(backdropKey);
        }
      }
      if (initialUrlParams.config) {
        updateConfig(initialUrlParams.config);
      }
      if (initialUrlParams.scatterPlotConfig) {
        const newScatterPlotConfig = initialUrlParams.scatterPlotConfig;
        // For backwards-compatibility, cast xAxis and yAxis to feature keys.
        if (newScatterPlotConfig.xAxis) {
          newScatterPlotConfig.xAxis = dataset?.findFeatureByKeyOrName(newScatterPlotConfig.xAxis);
        }
        if (newScatterPlotConfig.yAxis) {
          newScatterPlotConfig.yAxis = dataset?.findFeatureByKeyOrName(newScatterPlotConfig.yAxis);
        }
        updateScatterPlotConfig(initialUrlParams.scatterPlotConfig);
      }
    };

    setupInitialParameters();
  }, [isInitialDatasetLoaded]);

  // DISPLAY CONTROLS //////////////////////////////////////////////////////
  const handleDatasetChange = useCallback(
    async (newDatasetKey: string): Promise<void> => {
      if (newDatasetKey !== datasetKey && collection) {
        const result = await collection.tryLoadDataset(newDatasetKey);
        if (result.loaded) {
          await replaceDataset(result.dataset, newDatasetKey);
        } else {
          // TODO: What happens when you try to load a bad dataset from the dropdown? Notifications?
          console.error(result.errorMessage);
          notificationApi["error"]({
            message: "Error loading dataset:",
            description: result.errorMessage,
            placement: "bottomLeft",
            duration: 4,
          });
        }
      }
    },
    [replaceDataset, collection, datasetKey]
  );

  /**
   * Attempt to load a URL provided in the Load menu.
   * The URL may either be a collection or a dataset, so handle it as an ambiguous URL.
   * @throws an error if the URL could not be loaded.
   * @returns the absolute path of the URL resource that was loaded.
   */
  const handleDatasetLoad = useCallback(
    (newCollection: Collection, newDatasetKey: string, newDataset: Dataset): void => {
      setCollection(newCollection);
      setFeatureThresholds([]); // Clear when switching collections
      replaceDataset(newDataset, newDatasetKey);
    },
    [replaceDataset]
  );

  const getFeatureValue = useCallback(
    (id: number): string => {
      if (!featureKey || !dataset) {
        return "";
      }
      // Look up feature value from id
      const featureData = dataset.getFeatureData(featureKey);
      // ?? is a nullish coalescing operator; it checks for null + undefined values
      // (safe for falsy values like 0 or NaN, which are valid feature values)
      const featureValue = featureData?.data[id] ?? -1;
      const unitsLabel = featureData?.units ? ` ${featureData?.units}` : "";
      // Check if int, otherwise return float
      return numberToStringDecimal(featureValue, 3) + unitsLabel;
    },
    [featureKey, dataset]
  );

  // SCRUBBING CONTROLS ////////////////////////////////////////////////////
  timeControls.setFrameCallback(setFrame);

  const handleKeyDown = useCallback(
    ({ key }: KeyboardEvent): void => {
      if (key === "ArrowLeft" || key === "Left") {
        timeControls.advanceFrame(-1);
      } else if (key === "ArrowRight" || key === "Right") {
        timeControls.advanceFrame(1);
      }
    },
    [timeControls]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  // Store the current value of the time slider as its own state, and update
  // the frame using a debounced value to prevent constant updates as it moves.
  const debouncedFrameInput = useDebounce(frameInput, 250);
  useEffect(() => {
    setFrame(debouncedFrameInput);
  }, [debouncedFrameInput]);

  // When the slider is released, check if playback was occurring and resume it.
  // We need to attach the pointerup event listener to the document because it will not fire
  // if the user releases the pointer outside of the slider.
  useEffect(() => {
    const checkIfPlaybackShouldUnpause = async (): Promise<void> => {
      setFrame(frameInput);
      if (isTimeSliderDraggedDuringPlayback) {
        // Update the frame and optionally unpause playback when the slider is released.
        setIsTimeSliderDraggedDuringPlayback(false);
        timeControls.play(); // resume playing
      }
    };

    document.addEventListener("pointerup", checkIfPlaybackShouldUnpause);
    return () => {
      document.removeEventListener("pointerup", checkIfPlaybackShouldUnpause);
    };
  });

  // RECORDING CONTROLS ////////////////////////////////////////////////////

  // Update the callback for TimeControls and RecordingControls if it changes.
  timeControls.setFrameCallback(setFrame);

  const setFrameAndRender = useCallback(
    async (frame: number) => {
      await setFrame(frame);
      canv.render();
    },
    [setFrame, canv]
  );

  // RENDERING /////////////////////////////////////////////////////////////

  const openCopyNotification = (): void => {
    navigator.clipboard.writeText(document.URL);
    notificationApi["success"]({
      message: "URL copied to clipboard",
      placement: "bottomLeft",
      duration: 4,
      icon: <CheckCircleOutlined style={{ color: theme.color.text.success }} />,
    });
  };

  const getFeatureDropdownData = useCallback((): string[] | { key: string; label: string }[] => {
    if (!dataset) {
      return [];
    }
    // Add units to the dataset feature names if present
    return dataset.featureKeys.map((key) => {
      return { key, label: dataset.getFeatureNameWithUnits(key) };
    });
  }, [dataset]);

  const disableUi: boolean = isRecording || !datasetOpen;
  const disableTimeControlsUi = disableUi;

  // Show min + max marks on the color ramp slider if a feature is selected and
  // is currently being thresholded/filtered on.
  const getColorMapSliderMarks = (): undefined | number[] => {
    const featureData = dataset?.getFeatureData(featureKey);
    if (!featureData || featureThresholds.length === 0) {
      return undefined;
    }
    const threshold = featureThresholds.find(thresholdMatchFinder(featureKey, featureData.units));
    if (!threshold || !isThresholdNumeric(threshold)) {
      return undefined;
    }
    return [threshold.min, threshold.max];
  };

  let hoveredFeatureValue = "";
  if (lastHoveredId !== null && dataset) {
    const featureVal = getFeatureValue(lastHoveredId);
    const categories = dataset.getFeatureCategories(featureKey);
    if (categories !== null) {
      hoveredFeatureValue = categories[Number.parseInt(featureVal, 10)];
    } else {
      hoveredFeatureValue = featureVal;
    }
  }

  return (
    <div>
      <div ref={notificationContainer}>{notificationContextHolder}</div>

      <Header>
        <h3>{collection?.metadata.name ?? null}</h3>
        <FlexRowAlignCenter $gap={12}>
          <FlexRowAlignCenter $gap={2}>
            <LoadDatasetButton onLoad={handleDatasetLoad} currentResourceUrl={collection?.url || datasetKey} />
            <Export
              totalFrames={dataset?.numberOfFrames || 0}
              setFrame={setFrameAndRender}
              getCanvas={() => canv.domElement}
              // Stop playback when exporting
              onClick={() => timeControls.pause()}
              currentFrame={currentFrame}
              defaultImagePrefix={datasetKey + "-" + featureKey}
              disabled={dataset === null}
              setIsRecording={setIsRecording}
            />
            <TextButton onClick={openCopyNotification}>
              <LinkOutlined />
              <p>Copy URL</p>
            </TextButton>
          </FlexRowAlignCenter>
          <HelpDropdown />
        </FlexRowAlignCenter>
      </Header>

      {/** Main Content: Contains canvas and plot, ramp controls, time controls, etc. */}
      <div className={styles.mainContent}>
        {/** Top Control Bar */}
        <FlexRowAlignCenter $gap={12} style={{ margin: "16px 0", flexWrap: "wrap" }}>
          <SelectionDropdown
            disabled={disableUi}
            label="Dataset"
            selected={datasetKey}
            buttonType="primary"
            items={collection?.getDatasetKeys() || []}
            onChange={handleDatasetChange}
          />
          <SelectionDropdown
            disabled={disableUi}
            label="Feature"
            selected={featureKey}
            items={getFeatureDropdownData()}
            onChange={(value) => {
              if (value !== featureKey && dataset) {
                replaceFeature(dataset, value);
                resetColorRampRangeToDefaults(dataset, value);
              }
            }}
          />

          <ColorRampDropdown
            knownColorRamps={KNOWN_COLOR_RAMPS}
            colorRampsToDisplay={DISPLAY_COLOR_RAMP_KEYS}
            selectedRamp={colorRampKey}
            reversed={colorRampReversed}
            onChangeRamp={(name, reversed) => {
              setColorRampKey(name);
              setColorRampReversed(reversed);
            }}
            disabled={disableUi}
            knownCategoricalPalettes={KNOWN_CATEGORICAL_PALETTES}
            categoricalPalettesToDisplay={DISPLAY_CATEGORICAL_PALETTE_KEYS}
            useCategoricalPalettes={dataset?.isFeatureCategorical(featureKey) || false}
            numCategories={dataset?.getFeatureCategories(featureKey)?.length || 1}
            selectedPalette={categoricalPalette}
            onChangePalette={setCategoricalPalette}
          />
        </FlexRowAlignCenter>

        {/* Organize the main content areas */}
        <div className={styles.contentPanels}>
          <div className={styles.canvasPanel}>
            {/** Canvas */}
            <div className={styles.canvasTopAndCanvasContainer}>
              <div className={styles.canvasTopContainer}>
                <h3 style={{ margin: "0" }}>
                  {dataset ? dataset.getFeatureNameWithUnits(featureKey) : "Feature value range"}
                </h3>
                <FlexRowAlignCenter $gap={12} style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
                  <div style={{ flexBasis: 250, flexShrink: 2, flexGrow: 2, minWidth: "75px" }}>
                    {
                      // Render either a categorical color picker or a range slider depending on the feature type
                      dataset?.isFeatureCategorical(featureKey) ? (
                        <CategoricalColorPicker
                          categories={dataset.getFeatureCategories(featureKey) || []}
                          selectedPalette={categoricalPalette}
                          onChangePalette={setCategoricalPalette}
                          disabled={disableUi}
                        />
                      ) : (
                        <LabeledRangeSlider
                          min={colorRampMin}
                          max={colorRampMax}
                          minSliderBound={dataset?.getFeatureData(featureKey)?.min}
                          maxSliderBound={dataset?.getFeatureData(featureKey)?.max}
                          onChange={function (min: number, max: number): void {
                            setColorRampMin(min);
                            setColorRampMax(max);
                          }}
                          marks={getColorMapSliderMarks()}
                          disabled={disableUi}
                        />
                      )
                    }
                  </div>
                  <div style={{ flexBasis: 100, flexShrink: 1, flexGrow: 1, width: "fit-content" }}>
                    <Checkbox
                      checked={config.keepRangeBetweenDatasets}
                      onChange={() => {
                        // Invert lock on range
                        updateConfig({ keepRangeBetweenDatasets: !config.keepRangeBetweenDatasets });
                      }}
                    >
                      Keep range when switching datasets and features
                    </Checkbox>
                  </div>
                </FlexRowAlignCenter>
              </div>
              <HoverTooltip
                tooltipContent={
                  <>
                    <p>Track ID: {lastHoveredId && dataset?.getTrackId(lastHoveredId)}</p>
                    <p>
                      {dataset?.getFeatureName(featureKey) || "Feature"}:{" "}
                      <span style={{ whiteSpace: "nowrap" }}>{hoveredFeatureValue}</span>
                    </p>
                  </>
                }
                disabled={!showHoveredId}
              >
                <CanvasWrapper
                  canv={canv}
                  dataset={dataset}
                  selectedBackdropKey={selectedBackdropKey}
                  colorRamp={getColorMap(colorRampData, colorRampKey, colorRampReversed)}
                  colorRampMin={colorRampMin}
                  colorRampMax={colorRampMax}
                  categoricalColors={categoricalPalette}
                  selectedTrack={selectedTrack}
                  config={config}
                  onTrackClicked={(track) => {
                    setFindTrackInput("");
                    setSelectedTrack(track);
                  }}
                  inRangeLUT={inRangeLUT}
                  onMouseHover={(id: number): void => {
                    const isObject = id !== BACKGROUND_ID;
                    setShowHoveredId(isObject);
                    if (isObject) {
                      setLastHoveredId(id);
                    }
                  }}
                  onMouseLeave={() => setShowHoveredId(false)}
                />
              </HoverTooltip>
            </div>

            {/** Time Control Bar */}
            <div className={styles.timeControls}>
              {timeControls.isPlaying() || isTimeSliderDraggedDuringPlayback ? (
                // Swap between play and pause button
                <IconButton type="outlined" disabled={disableTimeControlsUi} onClick={() => timeControls.pause()}>
                  <PauseOutlined />
                </IconButton>
              ) : (
                <IconButton disabled={disableTimeControlsUi} onClick={() => timeControls.play()} type="outlined">
                  <CaretRightOutlined />
                </IconButton>
              )}

              <div
                className={styles.timeSliderContainer}
                onPointerDownCapture={() => {
                  if (timeControls.isPlaying()) {
                    // If the slider is dragged while playing, pause playback.
                    timeControls.pause();
                    setIsTimeSliderDraggedDuringPlayback(true);
                  }
                }}
              >
                <Slider
                  min={0}
                  max={dataset ? dataset.numberOfFrames - 1 : 0}
                  disabled={disableTimeControlsUi}
                  value={frameInput}
                  onChange={(value) => {
                    setFrameInput(value);
                  }}
                />
              </div>

              <IconButton
                disabled={disableTimeControlsUi}
                onClick={() => timeControls.advanceFrame(-1)}
                type="outlined"
              >
                <StepBackwardFilled />
              </IconButton>
              <IconButton disabled={disableTimeControlsUi} onClick={() => timeControls.advanceFrame(1)} type="outlined">
                <StepForwardFilled />
              </IconButton>

              <SpinBox
                min={0}
                max={dataset?.numberOfFrames && dataset?.numberOfFrames - 1}
                value={frameInput}
                onChange={setFrame}
                disabled={disableTimeControlsUi}
                wrapIncrement={true}
              />
              <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, justifyContent: "flex-end" }}>
                <PlaybackSpeedControl
                  fps={playbackFps}
                  onChange={(fps) => {
                    setPlaybackFps(fps);
                    timeControls.setPlaybackFps(fps);
                  }}
                  disabled={disableTimeControlsUi}
                />
              </div>
            </div>
          </div>
          <div className={styles.sidePanels}>
            <div className={styles.plotAndFiltersPanel}>
              <Tabs
                type="card"
                style={{ marginBottom: 0, width: "100%" }}
                size="large"
                activeKey={config.openTab}
                onChange={(key) => updateConfig({ openTab: key as TabType })}
                items={[
                  {
                    label: "Track plot",
                    key: TabType.TRACK_PLOT,
                    children: (
                      <div className={styles.tabContent}>
                        <PlotTab
                          findTrackInputText={findTrackInput}
                          setFindTrackInputText={setFindTrackInput}
                          findTrack={findTrack}
                          currentFrame={currentFrame}
                          dataset={dataset}
                          featureKey={featureKey}
                          selectedTrack={selectedTrack}
                          disabled={disableUi}
                        />
                      </div>
                    ),
                  },
                  {
                    label: "Scatter plot",
                    key: TabType.SCATTER_PLOT,
                    children: (
                      <div className={styles.tabContent}>
                        <ScatterPlotTab
                          dataset={dataset}
                          currentFrame={currentFrame}
                          selectedTrack={selectedTrack}
                          findTrack={findTrack}
                          setFrame={setFrameAndRender}
                          isVisible={config.openTab === TabType.SCATTER_PLOT}
                          isPlaying={timeControls.isPlaying() || isRecording}
                          selectedFeatureKey={featureKey}
                          colorRampMin={colorRampMin}
                          colorRampMax={colorRampMax}
                          colorRamp={getColorMap(colorRampData, colorRampKey, colorRampReversed)}
                          categoricalPalette={categoricalPalette}
                          inRangeIds={inRangeLUT}
                          viewerConfig={config}
                          scatterPlotConfig={scatterPlotConfig}
                          updateScatterPlotConfig={updateScatterPlotConfig}
                        />
                      </div>
                    ),
                  },
                  {
                    label: "Filters",
                    key: TabType.FILTERS,
                    children: (
                      <div className={styles.tabContent}>
                        <FeatureThresholdsTab
                          featureThresholds={featureThresholds}
                          onChange={setFeatureThresholds}
                          dataset={dataset}
                          disabled={disableUi}
                          categoricalPalette={categoricalPalette}
                        />
                      </div>
                    ),
                  },
                  {
                    label: "Viewer settings",
                    key: TabType.SETTINGS,
                    children: (
                      <div className={styles.tabContent}>
                        <SettingsTab
                          config={config}
                          updateConfig={updateConfig}
                          dataset={dataset}
                          // TODO: This could be part of a dataset-specific settings object
                          selectedBackdropKey={selectedBackdropKey}
                          setSelectedBackdropKey={setSelectedBackdropKey}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Viewer;
