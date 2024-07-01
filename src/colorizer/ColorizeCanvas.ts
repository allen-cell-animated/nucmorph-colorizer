import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  GLSL3,
  Line,
  LineBasicMaterial,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RGBAIntegerFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { MAX_FEATURE_CATEGORIES } from "../constants";
import { DrawMode, FeatureDataType, OUT_OF_RANGE_COLOR_DEFAULT, OUTLIER_COLOR_DEFAULT } from "./types";
import { packDataTexture } from "./utils/texture_utils";

import CanvasOverlay from "./CanvasUIOverlay";
import ColorRamp from "./ColorRamp";
import Dataset, { FeatureData } from "./Dataset";
import Track from "./Track";

import pickFragmentShader from "./shaders/cellId_RGBA8U.frag";
import vertexShader from "./shaders/colorize.vert";
import fragmentShader from "./shaders/colorize_RGBA8U.frag";

const BACKGROUND_COLOR_DEFAULT = 0xffffff;
const SELECTED_COLOR_DEFAULT = 0xff00ff;
export const BACKGROUND_ID = -1;

type ColorizeUniformTypes = {
  /** Scales from canvas coordinates to frame coordinates. */
  canvasToFrameScale: Vector2;
  /** XY offset of the frame, in normalized frame coordinates. [-0.5, 0.5] range. */
  panOffset: Vector2;
  /** Image, mapping each pixel to an object ID using the RGBA values. */
  frame: Texture;
  objectOpacity: number;
  /** The feature value of each object ID. */
  featureData: Texture;
  outlierData: Texture;
  inRangeIds: Texture;
  featureColorRampMin: number;
  featureColorRampMax: number;
  /** UI overlay for scale bars and timestamps. */
  overlay: Texture;
  /** Image backdrop, rendered behind the main frame object data. */
  backdrop: Texture;
  backdropBrightness: number;
  backdropSaturation: number;
  colorRamp: Texture;
  backgroundColor: Color;
  canvasBackgroundColor: Color;
  outlierColor: Color;
  outOfRangeColor: Color;
  highlightedId: number;
  hideOutOfRange: boolean;
  outlierDrawMode: number;
  outOfRangeDrawMode: number;
};

type ColorizeUniforms = { [K in keyof ColorizeUniformTypes]: Uniform<ColorizeUniformTypes[K]> };

const getDefaultUniforms = (): ColorizeUniforms => {
  const emptyBackdrop = new DataTexture(new Uint8Array([1, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  const emptyFrame = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAIntegerFormat, UnsignedByteType);
  emptyFrame.internalFormat = "RGBA8UI";
  emptyFrame.needsUpdate = true;
  const emptyOverlay = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);

  const emptyFeature = packDataTexture([0], FeatureDataType.F32);
  const emptyOutliers = packDataTexture([0], FeatureDataType.U8);
  const emptyInRangeIds = packDataTexture([0], FeatureDataType.U8);
  const emptyColorRamp = new ColorRamp(["#aaa", "#fff"]).texture;

  return {
    panOffset: new Uniform(new Vector2(0, 0)),
    canvasToFrameScale: new Uniform(new Vector2(1, 1)),
    frame: new Uniform(emptyFrame),
    featureData: new Uniform(emptyFeature),
    outlierData: new Uniform(emptyOutliers),
    inRangeIds: new Uniform(emptyInRangeIds),
    overlay: new Uniform(emptyOverlay),
    objectOpacity: new Uniform(1.0),
    backdrop: new Uniform(emptyBackdrop),
    backdropBrightness: new Uniform(0.75),
    backdropSaturation: new Uniform(1.0),
    featureColorRampMin: new Uniform(0),
    featureColorRampMax: new Uniform(1),
    colorRamp: new Uniform(emptyColorRamp),
    highlightedId: new Uniform(-1),
    hideOutOfRange: new Uniform(false),
    backgroundColor: new Uniform(new Color(BACKGROUND_COLOR_DEFAULT)),
    canvasBackgroundColor: new Uniform(new Color(BACKGROUND_COLOR_DEFAULT)),
    outlierColor: new Uniform(new Color(OUTLIER_COLOR_DEFAULT)),
    outOfRangeColor: new Uniform(new Color(OUT_OF_RANGE_COLOR_DEFAULT)),
    outlierDrawMode: new Uniform(DrawMode.USE_COLOR),
    outOfRangeDrawMode: new Uniform(DrawMode.USE_COLOR),
  };
};

export default class ColorizeCanvas {
  private geometry: PlaneGeometry;
  private material: ShaderMaterial;
  private pickMaterial: ShaderMaterial;
  private mesh: Mesh;
  private pickMesh: Mesh;

  /** UI overlay for scale bars, timestamps, and other information. */
  public overlay: CanvasOverlay;

  // Rendered track line that shows the trajectory of a cell.
  private line: Line;
  private showTrackPath: boolean;

  private showTimestamp: boolean;
  private showScaleBar: boolean;
  private frameSizeInCanvasCoordinates: Vector2;
  private frameToCanvasCoordinates: Vector2;

  /**
   * The zoom level of the frame in the canvas. At default zoom level 1, the frame will be
   * either the width or height of the canvas while maintaining the aspect ratio. A zoom level
   * of 2.0 means the frame will be twice that size.
   */
  private zoomMultiplier: number;
  /**
   * The offset of the frame in the canvas, in normalized frame coordinates. [0, 0] means the
   * frame will be centered, while [-0.5, -0.5] means the top right corner of the frame will be
   * centered in the canvas view.
   */
  private panOffset: Vector2;

  private scene: Scene;
  private pickScene: Scene;
  private camera: OrthographicCamera;
  private renderer: WebGLRenderer;
  private pickRenderTarget: WebGLRenderTarget;

  private dataset: Dataset | null;
  private track: Track | null;
  private points: Float32Array;
  private canvasResolution: Vector2 | null;

  private featureData: FeatureData | null;
  private selectedBackdropKey: string | null;
  private colorRamp: ColorRamp;
  private colorMapRangeMin: number;
  private colorMapRangeMax: number;
  private categoricalPalette: ColorRamp;
  private currentFrame: number;

  private onFrameChangeCallback: (isMissing: boolean) => void;

  constructor() {
    this.geometry = new PlaneGeometry(2, 2);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: getDefaultUniforms(),
      depthWrite: false,
      depthTest: false,
      glslVersion: GLSL3,
    });
    this.pickMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader: pickFragmentShader,
      uniforms: getDefaultUniforms(),
      depthWrite: false,
      depthTest: false,
      glslVersion: GLSL3,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.pickMesh = new Mesh(this.geometry, this.pickMaterial);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new Scene();
    this.scene.add(this.mesh);
    this.pickScene = new Scene();
    this.pickScene.add(this.pickMesh);

    // Configure lines
    this.points = new Float32Array([0, 0, 0]);

    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute("position", new BufferAttribute(this.points, 3));
    const lineMaterial = new LineBasicMaterial({
      color: SELECTED_COLOR_DEFAULT,
      linewidth: 1.0,
    });

    this.line = new Line(lineGeometry, lineMaterial);
    // Disable frustum culling for the line so it's always visible; prevents a bug
    // where the line disappears when the camera is zoomed in and panned.
    this.line.frustumCulled = false;

    this.scene.add(this.line);

    this.pickRenderTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
    });
    this.renderer = new WebGLRenderer();
    this.checkPixelRatio();

    this.dataset = null;
    this.canvasResolution = null;
    this.featureData = null;
    this.selectedBackdropKey = null;
    this.colorRamp = new ColorRamp(["black"]);
    this.categoricalPalette = new ColorRamp(["black"]);

    this.track = null;
    this.showTrackPath = false;
    this.colorMapRangeMin = 0;
    this.colorMapRangeMax = 0;
    this.currentFrame = 0;

    this.overlay = new CanvasOverlay();
    this.showScaleBar = false;
    this.showTimestamp = false;
    this.frameSizeInCanvasCoordinates = new Vector2(1, 1);
    this.frameToCanvasCoordinates = new Vector2(1, 1);
    this.zoomMultiplier = 1;
    this.panOffset = new Vector2(0, 0);

    this.onFrameChangeCallback = () => {};

    this.render = this.render.bind(this);
    this.getCurrentFrame = this.getCurrentFrame.bind(this);
    this.setOutOfRangeDrawMode = this.setOutOfRangeDrawMode.bind(this);
    this.updateScaling = this.updateScaling.bind(this);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private checkPixelRatio(): void {
    if (this.renderer.getPixelRatio() !== window.devicePixelRatio) {
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }
  }

  setSize(width: number, height: number): void {
    this.checkPixelRatio();

    this.renderer.setSize(width, height);
    this.overlay.setSize(width, height);
    // TODO: either make this a 1x1 target and draw it with a new camera every time we pick,
    // or keep it up to date with the canvas on each redraw (and don't draw to it when we pick!)
    this.pickRenderTarget.setSize(width, height);

    this.canvasResolution = new Vector2(width, height);
    if (this.dataset) {
      this.updateScaling(this.dataset.frameResolution, this.canvasResolution);
    }
  }

  setZoom(zoom: number): void {
    this.zoomMultiplier = zoom;
    if (this.dataset) {
      this.updateScaling(this.dataset.frameResolution, this.canvasResolution);
    }
    this.render();
  }

  /**
   * Sets the panned offset of the frame in the canvas, in normalized frame coordinates.
   * Expects x and y in a range of [-0.5, 0.5], where [0, 0] means the frame will be centered
   * and [-0.5, -0.5] means the top right corner of the frame will be centered in the canvas view.
   */
  setPan(x: number, y: number): void {
    this.panOffset = new Vector2(x, y);
    this.setUniform("panOffset", this.panOffset);

    // Adjust the line mesh position with scaling and panning
    this.line.position.set(
      2 * this.panOffset.x * this.frameToCanvasCoordinates.x,
      2 * this.panOffset.y * this.frameToCanvasCoordinates.y,
      0
    );
    this.render();
  }

  private updateScaleBar(): void {
    // Update the scale bar units
    const frameDims = this.dataset?.metadata.frameDims;
    // Ignore cases where dimensions have size 0
    const hasFrameDims = frameDims && frameDims.width !== 0 && frameDims.height !== 0;
    if (this.showScaleBar && hasFrameDims && this.canvasResolution !== null) {
      // `frameDims` are already in the provided unit scaling, so we figure out the current
      // size of the frame relative to the canvas to determine the canvas' width in units.
      // We only consider X scaling here because the scale bar is always horizontal.
      const canvasWidthInUnits = frameDims.width / this.frameSizeInCanvasCoordinates.x;
      const unitsPerScreenPixel = canvasWidthInUnits / this.canvasResolution.x;
      this.overlay.updateScaleBarOptions({ unitsPerScreenPixel, units: frameDims.units, visible: true });
    } else {
      this.overlay.updateScaleBarOptions({ visible: false });
    }
  }

  setScaleBarVisibility(visible: boolean): void {
    this.showScaleBar = visible;
    this.updateScaleBar();
    this.overlay.render();
  }

  private updateTimestamp(): void {
    // Calculate the current time stamp based on the current frame and the frame duration provided
    // by the dataset (optionally, hide the timestamp if the frame duration is not provided).
    // Pass along to the overlay as parameters.
    if (this.showTimestamp && this.dataset) {
      const frameDurationSec = this.dataset.metadata.frameDurationSeconds;
      if (frameDurationSec) {
        const startTimeSec = this.dataset.metadata.startTimeSeconds;
        // Note: there's some semi-redundant information here, since the current timestamp and max
        // timestamp could be calculated from the frame duration if we passed in the current + max
        // frames instead. For now, it's ok to keep those calculations here in ColorizeCanvas so the
        // overlay doesn't need to know frame numbers. The duration + start time are needed for
        // time display calculations, however.
        this.overlay.updateTimestampOptions({
          visible: true,
          frameDurationSec,
          startTimeSec,
          currTimeSec: this.currentFrame * frameDurationSec + startTimeSec,
          maxTimeSec: this.dataset.numberOfFrames * frameDurationSec + startTimeSec,
        });
        return;
      }
    }

    // Hide the timestamp if configuration is invalid or it's disabled.
    this.overlay.updateTimestampOptions({ visible: false });
  }

  setTimestampVisibility(visible: boolean): void {
    this.showTimestamp = visible;
    this.updateTimestamp();
    this.overlay.render();
  }

  private updateScaling(frameResolution: Vector2 | null, canvasResolution: Vector2 | null): void {
    if (!frameResolution || !canvasResolution) {
      return;
    }
    // Both the frame and the canvas have coordinates in a range of [0, 1] in the x and y axis.
    // However, the canvas may have a different aspect ratio than the frame, so we need to scale
    // the frame to fit within the canvas while maintaining the aspect ratio.
    const canvasAspect = canvasResolution.x / canvasResolution.y;
    const frameAspect = frameResolution.x / frameResolution.y;
    const unscaledFrameSizeInCanvasCoords: Vector2 = new Vector2(1, 1);
    if (canvasAspect > frameAspect) {
      // Canvas has a wider aspect ratio than the frame, so proportional height is 1
      // and we scale width accordingly.
      unscaledFrameSizeInCanvasCoords.x = canvasAspect / frameAspect;
    } else {
      unscaledFrameSizeInCanvasCoords.y = frameAspect / canvasAspect;
    }

    // Get final size by applying the current zoom level, where `zoomMultiplier=2` means the frame is 2x
    // larger than its base size. Save this to use when calculating units with the scale bar.
    this.frameSizeInCanvasCoordinates = unscaledFrameSizeInCanvasCoords.clone().multiplyScalar(this.zoomMultiplier);

    // Transforms from [0, 1] space of the canvas to the [0, 1] space of the frame by dividing by the zoom level.
    // ex: Let's say our frame has the same aspect ratio as the canvas, but our zoom is set to 2x.
    // Assuming that the [0, 0] position of the frame and the canvas are in the same position,
    // the position [1, 1] on the canvas should map to [0.5, 0.5] on the frame.
    const canvasToFrameCoordinates = unscaledFrameSizeInCanvasCoords.clone().divideScalar(this.zoomMultiplier);
    this.setUniform("canvasToFrameScale", canvasToFrameCoordinates);

    // Invert to get the frame to canvas coordinates. The line mesh is in frame coordinates, so transform it to
    // canvas coordinates so it matches the zoomed frame.
    this.frameToCanvasCoordinates = new Vector2(1 / canvasToFrameCoordinates.x, 1 / canvasToFrameCoordinates.y);

    this.line.scale.set(this.frameToCanvasCoordinates.x, this.frameToCanvasCoordinates.y, 1);
    // The line mesh is centered at [0,0]. Adjust the line mesh position with scaling and panning
    this.line.position.set(
      2 * this.panOffset.x * this.frameToCanvasCoordinates.x,
      2 * this.panOffset.y * this.frameToCanvasCoordinates.y,
      0
    );
    this.updateScaleBar();
  }

  public async setDataset(dataset: Dataset): Promise<void> {
    if (this.dataset !== null) {
      this.dataset.dispose();
    }
    this.dataset = dataset;
    if (this.dataset.outliers) {
      this.setUniform("outlierData", packDataTexture(Array.from(this.dataset.outliers), FeatureDataType.U8));
    } else {
      this.setUniform("outlierData", packDataTexture([0], FeatureDataType.U8));
    }

    const frame = this.currentFrame;
    this.currentFrame = -1;
    await this.setFrame(frame);
    this.updateScaling(this.dataset.frameResolution, this.canvasResolution);
    this.render();
  }

  private setUniform<U extends keyof ColorizeUniformTypes>(name: U, value: ColorizeUniformTypes[U]): void {
    this.material.uniforms[name].value = value;
    this.pickMaterial.uniforms[name].value = value;
  }

  /** Sets the current color ramp. Used when a continuous or discrete feature is selected. */
  setColorRamp(ramp: ColorRamp): void {
    if (this.colorRamp !== ramp) {
      // Dispose of existing ramp
      this.colorRamp.dispose();
    }
    this.colorRamp = ramp;
  }

  setCategoricalColors(colors: Color[]): void {
    this.categoricalPalette.dispose();
    this.categoricalPalette = new ColorRamp(colors);
  }

  setBackgroundColor(color: Color): void {
    this.setUniform("backgroundColor", color);
  }

  /** Set the color of the area outside the frame in the canvas. */
  setCanvasBackgroundColor(color: Color): void {
    this.setUniform("canvasBackgroundColor", color);
  }

  setOutlierDrawMode(mode: DrawMode, color?: Color): void {
    this.setUniform("outlierDrawMode", mode);
    if (mode === DrawMode.USE_COLOR && color) {
      this.setUniform("outlierColor", color);
    }
  }

  setOutOfRangeDrawMode(mode: DrawMode, color?: Color): void {
    this.setUniform("outOfRangeDrawMode", mode);
    if (mode === DrawMode.USE_COLOR && color) {
      this.setUniform("outOfRangeColor", color);
    }
  }

  setSelectedTrack(track: Track | null): void {
    if (this.track && this.track?.trackId === track?.trackId) {
      return;
    }
    this.track = track;
    if (!track || !track.centroids || track.centroids.length === 0 || !this.dataset) {
      return;
    }
    // Make a new array of the centroid positions in pixel coordinates.
    // Points are in 3D while centroids are pairs of 2D coordinates in a 1D array
    this.points = new Float32Array(track.duration() * 3);

    // Tracks may be missing objects for some timepoints, so use the last known good value as a fallback
    let lastTrackIndex = 0;
    for (let i = 0; i < track.duration(); i++) {
      const absTime = i + track.startTime();

      let trackIndex = track.times.findIndex((t) => t === absTime);
      if (trackIndex === -1) {
        // Track has no object for this time, use fallback
        trackIndex = lastTrackIndex;
      } else {
        lastTrackIndex = trackIndex;
      }

      // Normalize from pixel coordinates to canvas space [-1, 1]
      this.points[3 * i + 0] = (track.centroids[2 * trackIndex] / this.dataset.frameResolution.x) * 2.0 - 1.0;
      this.points[3 * i + 1] = -((track.centroids[2 * trackIndex + 1] / this.dataset.frameResolution.y) * 2.0 - 1.0);
      this.points[3 * i + 2] = 0;
    }
    // Assign new BufferAttribute because the old array has been discarded.
    this.line.geometry.setAttribute("position", new BufferAttribute(this.points, 3));
    this.line.geometry.getAttribute("position").needsUpdate = true;
    this.updateTrackRange();
  }

  setShowTrackPath(show: boolean): void {
    this.showTrackPath = show;
  }

  /**
   * Updates the range of the track path line so that it shows up the path up to the current
   * frame.
   */
  updateTrackRange(): void {
    // Show nothing if track doesn't exist or doesn't have centroid data
    if (!this.track || !this.track.centroids || !this.showTrackPath) {
      this.line.geometry.setDrawRange(0, 0);
      return;
    }

    // Show path up to current frame
    let range = this.currentFrame - this.track.startTime() + 1;

    if (range > this.track.duration() || range < 0) {
      // Hide track if we are outside the track range
      range = 0;
    }

    this.line.geometry.setDrawRange(0, range);
  }

  private updateHighlightedId(): void {
    // Hide highlight if no track is selected
    if (!this.track) {
      this.setUniform("highlightedId", -1);
      return;
    }
    this.setUniform("highlightedId", this.track.getIdAtTime(this.currentFrame));
  }

  setFeature(featureData: FeatureData): void {
    this.featureData = featureData;
    this.setUniform("featureData", featureData.tex);
    this.render(); // re-render necessary because map range may have changed
  }

  setColorMapRangeMin(newMin: number): void {
    this.colorMapRangeMin = newMin;
  }

  setColorMapRangeMax(newMax: number): void {
    this.colorMapRangeMax = newMax;
  }

  resetColorMapRange(): void {
    if (this.featureData) {
      this.colorMapRangeMin = this.featureData.min;
      this.colorMapRangeMax = this.featureData.max;
      this.setUniform("featureColorRampMin", this.colorMapRangeMin);
      this.setUniform("featureColorRampMax", this.colorMapRangeMax);
    }
  }

  setInRangeLUT(inRangeLUT: Uint8Array): void {
    // Save the array to a texture and pass it into the shader
    if (inRangeLUT.length > 0) {
      this.setUniform("inRangeIds", packDataTexture(Array.from(inRangeLUT), FeatureDataType.U8));
      this.render();
    }
  }

  getColorMapRangeMin(): number {
    return this.colorMapRangeMin;
  }

  getColorMapRangeMax(): number {
    return this.colorMapRangeMax;
  }

  /**
   * @returns The number of frames in the dataset. If no dataset is loaded,
   * returns 0 by default.
   */
  getTotalFrames(): number {
    return this.dataset ? this.dataset.numberOfFrames : 0;
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  public isValidFrame(index: number): boolean {
    return index >= 0 && index < this.getTotalFrames();
  }

  public setObjectOpacity(percentOpacity: number): void {
    percentOpacity = Math.max(0, Math.min(100, percentOpacity));
    this.setUniform("objectOpacity", percentOpacity / 100);
  }

  public setBackdropSaturation(percentSaturation: number): void {
    percentSaturation = Math.max(0, Math.min(100, percentSaturation));
    this.setUniform("backdropSaturation", percentSaturation / 100);
  }

  public setBackdropBrightness(percentBrightness: number): void {
    percentBrightness = Math.max(0, Math.min(200, percentBrightness));
    this.setUniform("backdropBrightness", percentBrightness / 100);
  }

  public setBackdropKey(key: string | null): void {
    this.selectedBackdropKey = key;
    this.setFrame(this.currentFrame, true).then(() => {
      this.render();
    });
  }

  public setOnFrameChangeCallback(callback: (isMissing: boolean) => void): void {
    this.onFrameChangeCallback = callback;
  }

  /**
   * Sets the current frame of the canvas, loading the new frame data if the
   * frame number changes.
   * @param index Index of the new frame.
   * @param forceUpdate Force a reload of the frame data, even if the frame
   * is already loaded.
   */
  async setFrame(index: number, forceUpdate: boolean = false): Promise<void> {
    // Ignore same or bad frame indices
    if ((!forceUpdate && this.currentFrame === index) || !this.isValidFrame(index)) {
      return;
    }
    // New frame, so load the frame data.
    this.currentFrame = index;
    let backdropPromise = undefined;
    if (this.selectedBackdropKey && this.dataset?.hasBackdrop(this.selectedBackdropKey)) {
      backdropPromise = this.dataset?.loadBackdrop(this.selectedBackdropKey, index);
    }
    const framePromise = this.dataset?.loadFrame(index);
    const result = await Promise.allSettled([framePromise, backdropPromise]);
    const [frame, backdrop] = result;

    if (this.currentFrame !== index) {
      // This load request has been superceded by a request for another frame, which has already loaded in image data.
      // Drop this request.
      return;
    }

    let isMissingFile = false;

    if (backdrop.status === "fulfilled" && backdrop.value) {
      this.setUniform("backdrop", backdrop.value);
    } else {
      if (backdrop.status === "rejected") {
        // Only show error message if the backdrop load encountered an error (null/undefined backdrops aren't
        // considered errors, since that means the path has been deliberately marked as missing.)
        console.error(
          "Failed to load backdrop " + this.selectedBackdropKey + " for frame " + index + ": ",
          backdrop.reason
        );
        isMissingFile = true;
      }
      this.setUniform("backdrop", new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType));
    }

    if (frame.status === "fulfilled" && frame.value) {
      this.setUniform("frame", frame.value);
    } else {
      if (frame.status === "rejected") {
        // Only show error message if the frame load encountered an error. (Null/undefined is okay)
        console.error("Failed to load frame " + index + ": ", frame.reason);
        isMissingFile = true;
      }
      // Set to blank
      const emptyFrame = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAIntegerFormat, UnsignedByteType);
      emptyFrame.internalFormat = "RGBA8UI";
      emptyFrame.needsUpdate = true;
      this.setUniform("frame", emptyFrame);
    }

    this.onFrameChangeCallback(isMissingFile);
    // Force rescale in case frame dimensions changed
    this.updateScaling(this.dataset?.frameResolution || null, this.canvasResolution);
  }

  /** Switches the coloring between the categorical and color ramps depending on the currently
   * selected feature.
   */
  updateRamp(): void {
    if (this.featureData && this.dataset?.isFeatureCategorical(this.featureData.key)) {
      this.setUniform("colorRamp", this.categoricalPalette.texture);
      this.setUniform("featureColorRampMin", 0);
      this.setUniform("featureColorRampMax", MAX_FEATURE_CATEGORIES - 1);
    } else {
      this.setUniform("colorRamp", this.colorRamp.texture);
      this.setUniform("featureColorRampMin", this.colorMapRangeMin);
      this.setUniform("featureColorRampMax", this.colorMapRangeMax);
    }
  }

  render(): void {
    this.updateHighlightedId();
    this.updateTrackRange();
    this.updateRamp();

    // Overlay updates
    this.updateScaleBar();
    this.updateTimestamp();

    // Draw the overlay, and pass the resulting image as a texture to the shader.
    this.overlay.render();
    const overlayTexture = new CanvasTexture(this.overlay.canvas);
    this.setUniform("overlay", overlayTexture);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.dataset?.dispose();
    this.dataset = null;
    this.material.dispose();
    this.geometry.dispose();
    this.renderer.dispose();
    this.pickMaterial.dispose();
  }

  getIdAtPixel(x: number, y: number): number {
    const rt = this.renderer.getRenderTarget();

    this.renderer.setRenderTarget(this.pickRenderTarget);
    this.renderer.render(this.pickScene, this.camera);

    const pixbuf = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.pickRenderTarget, x, this.pickRenderTarget.height - y, 1, 1, pixbuf);
    // restore main render target
    this.renderer.setRenderTarget(rt);

    // get 32bit value from 4 8bit values
    const value = pixbuf[0] | (pixbuf[1] << 8) | (pixbuf[2] << 16) | (pixbuf[3] << 24);
    // offset by 1 since 0 is background.
    return value - 1;
  }
}
