import React, { ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { Dataset, Plotting, Track } from "../colorizer";

import { FeatureData } from "../colorizer/Dataset";

type PlotWrapperProps = {
  frame: number;
  dataset: Dataset | null;
  featureData: FeatureData | null;
  selectedTrack: Track | null;
};
const defaultProps: Partial<PlotWrapperProps> = {};

/**
 * A wrapper around the Plotting class, allowing it to be updated via a React
 * component interface.
 */
export default function PlotWrapper(inputProps: PlotWrapperProps): ReactElement {
  const props = { ...defaultProps, ...inputProps } as Required<PlotWrapperProps>;

  const plotDivRef = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<Plotting | null>(null);

  // Setup for plot after initial render, since it replaces a DOM element.
  useEffect(() => {
    const plot = new Plotting(plotDivRef.current!);
    setPlot(plot);
    plot.removePlot(); // Clear initial plot for consistency
  }, []);

  // Update dataset when it changes
  useMemo(() => {
    plot?.removePlot();
    if (props.dataset) {
      plot?.setDataset(props.dataset);
    }
  }, [props.dataset]);

  // Update time in plot
  useMemo(() => {
    plot?.setTime(props.frame);
  }, [props.frame]);

  // Handle updates to selected track and feature, updating/clearing the plot accordingly.
  useMemo(() => {
    plot?.removePlot();
    if (props.selectedTrack && props.featureData) {
      plot?.plot(props.selectedTrack, props.featureData, props.frame);
    }
  }, [props.selectedTrack, props.featureData]);

  const updatePlotSize = (): void => {
    if (!plotDivRef.current) {
      return;
    }
    const width = plotDivRef.current.clientWidth;
    const height = plotDivRef.current.clientHeight;
    plot?.setSize(width, height);
  };

  useEffect(() => {
    updatePlotSize();
    // TODO: Troubleshoot using window.addEventListener for resizing, because
    // the native responsive behavior can be a bit slow.
    // Some layout issues occurred when using this, so it's disabled for now.
    // window.addEventListener("resize", updatePlotSize);
    // return () => window.removeEventListener("resize", updatePlotSize);
  }, [plot, plotDivRef.current]);

  return <div ref={plotDivRef} style={{ width: "auto", height: "auto", zIndex: "0" }}></div>;
}
