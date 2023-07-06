import ColorizeCanvas from "./ColorizeCanvas";

// time / playback controls
export default class TimeController {
  private playBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private forwardBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private timeSlider: HTMLInputElement;
  private timeInput: HTMLInputElement;

  private timerId: number;
  private redrawfn: () => void;

  private canvas: ColorizeCanvas;
  private isDisabled: boolean;

  constructor(canvas: ColorizeCanvas, redrawfn: () => void) {
    this.redrawfn = redrawfn;
    this.canvas = canvas;
    this.timerId = 0;
    this.isDisabled = false;

    this.playBtn = document.querySelector("#playBtn")!;
    this.pauseBtn = document.querySelector("#pauseBtn")!;
    this.forwardBtn = document.querySelector("#forwardBtn")!;
    this.backBtn = document.querySelector("#backBtn")!;
    this.timeSlider = document.querySelector("#timeSlider")!;
    this.timeInput = document.querySelector("#timeValue")!;
    this.playBtn.addEventListener("click", () => this.handlePlayButtonClick());
    this.pauseBtn.addEventListener("click", () => this.handlePauseButtonClick());
    this.forwardBtn.addEventListener("click", () => this.handleFrameAdvance(1));
    this.backBtn.addEventListener("click", () => this.handleFrameAdvance(-1));
    // only update when DONE sliding: change event
    this.timeSlider.addEventListener("change", () => this.handleTimeSliderChange());
    this.timeInput.addEventListener("change", () => this.handleTimeInputChange());
  }

  private wrapFrame(index: number): number {
    const totalFrames = this.canvas.getTotalFrames();
    return (index + totalFrames) % totalFrames;
  }
  
  private clampFrame(index: number): number {
    return Math.min(Math.max(index, 0), this.canvas.getTotalFrames() - 1);
  }

  private playTimeSeries(onNewFrameCallback: () => void): void {
    clearInterval(this.timerId);

    const loadNextFrame = async (): Promise<void> => {
      if (this.isDisabled) {
        // stop render loop if time controls have been disabled.
        return;
      }
      const nextFrame = this.wrapFrame(this.canvas.getCurrentFrame() + 1);

      // do the necessary update
      await this.canvas.setFrame(nextFrame);
      this.redrawfn();
      onNewFrameCallback();
    };
    this.timerId = window.setInterval(loadNextFrame, 40);
  }

  private async handlePlayButtonClick(): Promise<void> {
    if (this.canvas.getCurrentFrame() >= this.canvas.getTotalFrames() - 1) {
      await this.canvas.setFrame(0);
    }
    this.playTimeSeries(() => {
      this.updateUI();
    });
  }

  private handlePauseButtonClick(): void {
    clearInterval(this.timerId);
  }

  public async handleFrameAdvance(delta: number = 1): Promise<void> {
    await this.canvas.setFrame(this.wrapFrame(this.canvas.getCurrentFrame() + delta));
    this.redrawfn();
  }

  private async handleTimeSliderChange(): Promise<void> {
      if (this.canvas.isValidFrame(this.timeSlider.valueAsNumber)) {
        await this.canvas.setFrame(this.timeSlider.valueAsNumber);
        this.timeInput.value = this.timeSlider.value;
        this.redrawfn();
      }
  }
  private async handleTimeInputChange(): Promise<void> {
    const newFrame = this.clampFrame(this.timeInput.valueAsNumber);
    if (this.canvas.isValidFrame(newFrame)) {
      await this.canvas.setFrame(newFrame);
      this.timeSlider.value = this.timeInput.value;
      this.redrawfn();
    }
  }

  public setIsDisabled(disabled: boolean): void {
    this.isDisabled = disabled;
    // Disable and clean up playback interval timer
    if (disabled) {
      clearInterval(this.timerId);
    }
  }

  public updateUI(): void {
    this.timeSlider.max = `${this.canvas.getTotalFrames() - 1}`;
    this.timeInput.max = `${this.canvas.getTotalFrames() - 1}`;

    this.timeSlider.value = "" + this.canvas.getCurrentFrame();
    this.timeInput.value = "" + this.canvas.getCurrentFrame();
    this.timeSlider.disabled = this.isDisabled;
    this.timeInput.disabled = this.isDisabled;
    this.backBtn.disabled = this.isDisabled;
    this.forwardBtn.disabled = this.isDisabled;

    if (this.canvas.getTotalFrames() < 2 || this.isDisabled) {
      this.playBtn.disabled = true;
      this.pauseBtn.disabled = true;
    } else {
      this.playBtn.disabled = false;
      this.pauseBtn.disabled = false;
    }
  }
}
