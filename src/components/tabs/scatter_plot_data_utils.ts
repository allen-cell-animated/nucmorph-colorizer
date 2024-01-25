import { PlotData } from "plotly.js-dist-min";
import { ColorRampData } from "../../colorizer";
import { remap } from "../../colorizer/utils/math_utils";
import { Color } from "three";

export type DataArray = Uint32Array | Float32Array | number[];

export type TraceData = {
  x: number[];
  y: number[];
  objectIds: number[];
  trackIds: number[];
  color: Color;
};

export function subsampleColorRamp(colorRamp: ColorRampData, numColors: number): Color[] {
  const colors: Color[] = [];
  for (let i = 0; i < numColors; i++) {
    colors.push(colorRamp.colorRamp.sample(i / (numColors - 1)));
  }
  return colors;
}

/**
 * Returns the index of a bucket that a value should be sorted into, based on a provided range.
 * @param value
 * @param minValue Min value, inclusive.
 * @param maxValue Max value, inclusive.
 * @param numBuckets Number of buckets in the range between min and max values.
 * @returns The index of the bucket that the value should be sorted into, from 0 to `numBuckets - 1`.
 * Returns -1 if the value is out of bounds for the given range.
 */
export function getBucketIndex(value: number, minValue: number, maxValue: number, numBuckets: number): number {
  if (value < minValue || value > maxValue) {
    return -1;
  }
  return Math.round(remap(value, minValue, maxValue, 0, numBuckets - 1));
}

/**
 * Splits a trace into one or more traces so that all traces have at most `maxPoints`
 * data points.
 * @param traceData The trace to split. (Will not be modified.)
 * @param maxPoints The maximum number of points any trace can have.
 * @returns An array of traces, with the same color as the original trace.
 */
export function splitTraceData(traceData: TraceData, maxPoints: number): TraceData[] {
  if (traceData.x.length <= maxPoints) {
    return [traceData];
  }
  const traces: TraceData[] = [];
  for (let i = 0; i < traceData.x.length; i += maxPoints) {
    const end = Math.min(i + maxPoints, traceData.x.length);
    const trace: TraceData = {
      x: traceData.x.slice(i, end),
      y: traceData.y.slice(i, end),
      objectIds: traceData.objectIds.slice(i, end),
      trackIds: traceData.trackIds.slice(i, end),
      color: traceData.color,
    };
    traces.push(trace);
  }
  return traces;
}

/** Draws a simple line graph over the data points. */
export function makeLineTrace(xData: DataArray, yData: DataArray): Partial<Plotly.PlotData> {
  return {
    x: xData,
    y: yData,
    name: "",
    type: "scattergl",
    mode: "lines",
    line: {
      color: "#aaaaaa",
    },
  };
}

/**
 * Returns an array of Plotly traces that render a crosshair at the X,Y coordinates.
 */
export function drawCrosshair(x: number, y: number): Partial<PlotData>[] {
  const crosshair: Partial<PlotData> = {
    x: [x],
    y: [y],
    type: "scattergl",
    mode: "markers",
    marker: {
      size: 10,
      line: {
        color: "#000",
        width: 1,
      },
      symbol: "cross-thin",
    },
  };
  // Add a transparent white outline around the marker for contrast.
  const crosshairBg = { ...crosshair };
  crosshairBg.marker = {
    ...crosshairBg.marker,
    line: {
      color: "#ffffffa0",
      width: 4,
    },
  };
  return [crosshairBg, crosshair];
}
