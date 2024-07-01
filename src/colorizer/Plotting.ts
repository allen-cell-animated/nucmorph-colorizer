import Plotly from "plotly.js-dist-min";

import Dataset, { FeatureData } from "./Dataset";
import Track from "./Track";

const LINE_OPACITY = 0.5;
const LINE_COLOR = "rgb(25, 25, 25)";
const LINE_SPEC: Partial<Plotly.Shape> = {
  type: "line",
  x0: 0,
  y0: 0,
  x1: 0,
  yref: "paper",
  y1: 1,
  opacity: LINE_OPACITY,
  line: {
    color: LINE_COLOR,
    width: 1,
    dash: "dot",
  },
};

const CONFIG: Partial<Plotly.Config> = {
  displayModeBar: false,
  responsive: true,
};

export default class Plotting {
  private parentRef: HTMLElement;
  private dataset: Dataset | null;
  private trace: Plotly.Data | null;

  constructor(parentRef: HTMLElement) {
    this.dataset = null;
    this.trace = null;
    this.parentRef = parentRef;
    const layout: Partial<Plotly.Layout> = {
      xaxis: {
        title: "time index",
      },
      yaxis: {
        title: "[None]",
      },
      title: "No track selected",
      width: 600,
      height: 400,
    };

    Plotly.newPlot(this.parentRef, [], layout, CONFIG);
    this.plot = this.plot.bind(this);
  }

  setDataset(dataset: Dataset): void {
    this.dataset = dataset;
  }

  async plot(track: Track, featureData: FeatureData, time: number): Promise<void> {
    if (!this.dataset) {
      return;
    }
    const plotinfo = await this.dataset?.buildTrackFeaturePlot(track, featureData);
    this.trace = {
      x: plotinfo.domain,
      y: plotinfo.range,
      type: "scatter",
    };

    const layout: Partial<Plotly.Layout> = {
      yaxis: {
        title: this.dataset.getFeatureNameWithUnits(featureData.key),
      },
      shapes: [
        {
          ...LINE_SPEC,
          x0: time,
          x1: time,
        },
      ],
      title: "track " + track.trackId,
    };

    Plotly.react(this.parentRef, [this.trace], layout, CONFIG);
  }

  setTime(t: number): void {
    const layout: Partial<Plotly.Layout> = {
      shapes: [
        {
          ...LINE_SPEC,
          x0: t,
          x1: t,
        },
      ],
    };
    Plotly.relayout(this.parentRef, layout);
    //Plotly.react(this.parentDivId, this.trace ? [this.trace] : [], layout);
  }

  setSize(x: number, y: number): void {
    const layout: Partial<Plotly.Layout> = {
      width: x,
      height: y,
    };
    Plotly.relayout(this.parentRef, layout);
  }

  removePlot(): void {
    Plotly.react(this.parentRef, []);
  }
}
