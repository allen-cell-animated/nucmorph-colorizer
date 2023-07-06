import ColorizeCanvas from "./ColorizeCanvas";

export default class RecordingController {
  private startBtn: HTMLButtonElement;
  private abortBtn: HTMLButtonElement;
  private recording: boolean;
  private startAtCurrentFrameChkbx: HTMLInputElement;

  private filePrefixInput: HTMLInputElement;
  private filePrefixResetBtn: HTMLButtonElement;
  private useDefaultPrefix: boolean;
  private defaultPrefix: string;
  private hiddenAnchorEl: HTMLAnchorElement;

  private timerId: number;
  private startingFrame: number;
  private redrawfn: () => void;
  private isDisabled: boolean;

  private canvas: ColorizeCanvas;

  constructor(canvas: ColorizeCanvas, redrawfn: () => void) {
    this.useDefaultPrefix = true;
    this.defaultPrefix = "";    
    this.recording = false;
    this.canvas = canvas;
    this.timerId = 0;
    this.startingFrame = 0;
    this.redrawfn = redrawfn;
    this.isDisabled = false;

    this.startBtn = document.querySelector("#sequence_start_btn")!;
    this.abortBtn = document.querySelector("#sequence_abort_btn")!;
    this.filePrefixResetBtn = document.querySelector("#sequence_prefix_reset_btn")!;
    this.startAtCurrentFrameChkbx = document.querySelector("#sequence_start_frame_checkbox")!;
    this.filePrefixInput = document.querySelector("#sequence_prefix")!;

    this.hiddenAnchorEl = document.createElement("a");  // Hidden element for initiating download later

    this.startBtn.addEventListener("click", () => this.handleStartButtonClick());
    this.abortBtn.addEventListener("click", () => this.handleAbortButtonClick());
    this.filePrefixInput.addEventListener("changed", () => this.handlePrefixChanged());
    this.filePrefixResetBtn.addEventListener("click", () => this.handlePrefixResetClicked());
  }

  public setCanvas(canvas: ColorizeCanvas): void {
    this.canvas = canvas;
  }

  private async handleStartButtonClick(): Promise<void> {
    if (!this.recording) {
      this.startingFrame = this.canvas.getCurrentFrame();
      this.recording = true;

      if (!this.startAtCurrentFrameChkbx.checked) {
        await this.canvas.setFrame(0);  // start at beginning
      }
      this.startingFrame = this.canvas.getCurrentFrame();

      this.startRecording();  // Start recording loop
    }
  }

  private async handleAbortButtonClick(): Promise<void> {
    if (this.recording) {
      clearTimeout(this.timerId);
      this.recording = false;
      await this.canvas.setFrame(this.startingFrame);  // Reset to starting frame
      this.redrawfn();
    }
  }

  private async startRecording(): Promise<void> {
    // Reset any existing timers
    clearTimeout(this.timerId);

    // Formatting setup
    const maxDigits = this.canvas.getTotalFrames().toString().length;
    
    const loadAndRecordFrame = async (): Promise<void> => {
      const currentFrame = this.canvas.getCurrentFrame();
      
      // Trigger a render through the redrawfn parameter so other UI elements update
      this.redrawfn();
      
      // Get canvas as an image URL that can be downloaded
      const dataURL = this.canvas.domElement.toDataURL("image/png");
      const imageURL = dataURL.replace(/^data:image\/png/, "data:application/octet-stream");
      
      // Update our anchor (link) element with the image data, then force
      // a click to initiate the download.
      this.hiddenAnchorEl.href = imageURL;
      const frameNumber: string = currentFrame.toString().padStart(maxDigits, "0");
      this.hiddenAnchorEl.download = `${this.filePrefixInput.value}${frameNumber}.png`;
      this.hiddenAnchorEl.click();
      
      // Advance to the next frame, checking if we've exceeded bounds.
      if (this.canvas.isValidFrame(currentFrame + 1) && this.recording) {
        await this.canvas.setFrame(currentFrame + 1);
        // Trigger the next run.
        // Timeout is required to prevent skipped/dropped frames. 100 ms is a magic 
        // number that prevented frame drop on a developer machine, but is not very robust.
        // TODO: Replace magic number for frame delay with a check for download completion?
        this.timerId = setTimeout(loadAndRecordFrame, 100);
      } else {
        // Reached end, so stop and reset UI
        this.recording = false;
        await this.canvas.setFrame(this.startingFrame);  // Reset to starting frame
        this.redrawfn();
      }
    };
  
    // Start interval loop
    loadAndRecordFrame();
  }

  public handlePrefixChanged(): void {
    this.useDefaultPrefix = false;
  }

  public handlePrefixResetClicked(): void {
    this.useDefaultPrefix = true;
    this.updateUI();
  }

  public updateUI(): void {
    this.startBtn.disabled = this.recording || this.isDisabled;
    this.abortBtn.disabled = !this.recording || this.isDisabled;
    if (this.useDefaultPrefix) {
      this.filePrefixInput.value = this.defaultPrefix;
    }
  }

  public setDefaultFilePrefix(prefix: string): void {
    this.defaultPrefix = prefix;
    this.updateUI();
  }

  public setIsDisabled(disabled: boolean): void {
    this.isDisabled = disabled;
    this.updateUI();
  }

  public isRecording(): boolean {
    return this.recording;
  }
}
