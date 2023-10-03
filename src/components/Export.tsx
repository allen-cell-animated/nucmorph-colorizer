import { Button, Modal, Input, Radio, Space, RadioChangeEvent, InputNumber, App, Progress, Tooltip, Card } from "antd";
import React, { ReactElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import SpinBox from "./SpinBox";
import ImageSequenceRecorder from "../colorizer/recorders/ImageSequenceRecorder";
import Recorder from "../colorizer/RecordingControls";
import { AppThemeContext } from "./AppStyle";
import { CheckCircleOutlined } from "@ant-design/icons";
import WebCodecsMp4Recorder, { VideoBitrate } from "../colorizer/recorders/WebCodecsMp4Recorder";

type ExportButtonProps = {
  totalFrames: number;
  setFrame: (frame: number) => Promise<void>;
  getCanvas: () => HTMLCanvasElement;
  currentFrame: number;
  setIsRecording?: (recording: boolean) => void;
  defaultImagePrefix?: string;
  disabled?: boolean;
};

export const TEST_ID_EXPORT_ACTION_BUTTON = "export-action";
export const TEST_ID_OPEN_EXPORT_MODAL_BUTTON = "open-export-modal";

const defaultProps: Partial<ExportButtonProps> = {
  setIsRecording: () => {},
  defaultImagePrefix: "image",
  disabled: false,
};

const HorizontalDiv = styled.div`
  display: flex;
  flex-direction: row;
  gap: 6px;
  flex-wrap: wrap;
`;

const VerticalDiv = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const CustomRangeDiv = styled(HorizontalDiv)`
  & input {
    width: 70px;
    text-align: right;
  }
`;

const CustomRadio = styled(Radio)`
  & span {
    // Clip text when the radio is too narrow
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  & span:not(.ant-radio-button) {
    // Text span
    width: 100%;
    text-align: center;
  }
`;

const ExportModeRadioGroup = styled(Radio.Group)`
  & {
    // Use standard amount of padding, unless the view is too narrow
    padding: 0 calc(min(40px, 5vw));
  }
  & label {
    // Make the Radio options the same width
    flex-grow: 1;
    width: 50%;
  }
`;

const CustomRadioGroup = styled(Radio.Group)`
  & {
    display: flex;
    flex-direction: row;
  }
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(value, min));
}

/**
 * A single Export button that opens up an export modal when clicked. Manages starting and stopping
 * an image sequence recording, resetting state when complete.
 */
export default function Export(inputProps: ExportButtonProps): ReactElement {
  const props = { ...defaultProps, ...inputProps } as Required<ExportButtonProps>;

  const theme = useContext(AppThemeContext);

  const enum RangeMode {
    ALL,
    CURRENT,
    CUSTOM,
  }

  const enum RecordingMode {
    IMAGE_SEQUENCE,
    VIDEO_MP4,
  }

  // Static convenience method for creating simple modals + notifications.
  // Used here for the cancel modal and the success notification.
  // Note: notification API seems to only place notifications at the top-level under the
  // <body> tag, which causes some issues with styling.
  const { modal, notification } = App.useApp();
  const modalContextRef = useRef<HTMLDivElement>(null);

  const originalFrameRef = useRef(props.currentFrame);
  const [isLoadModalOpen, _setIsLoadModalOpen] = useState(false);
  const [isRecording, _setIsRecording] = useState(false);
  const [isPlayingCloseAnimation, setIsPlayingCloseAnimation] = useState(false);

  const [recordingMode, _setRecordingMode] = useState(RecordingMode.IMAGE_SEQUENCE);
  const recorder = useRef<Recorder | null>(null);

  const [rangeMode, setRangeMode] = useState(RangeMode.ALL);
  const [customMin, setCustomMin] = useState(0);
  const [customMax, setCustomMax] = useState(props.totalFrames - 1);
  const [imagePrefix, setImagePrefix] = useState(props.defaultImagePrefix);
  const [useDefaultImagePrefix, setUseDefaultImagePrefix] = useState(true);
  const [frameIncrement, setFrameIncrement] = useState(1);
  const [fps, setFps] = useState(30);
  const [videoQuality, setVideoQuality] = useState(VideoBitrate.MEDIUM);

  const [percentComplete, setPercentComplete] = useState(0);

  // Override setRecordingMode; users should not choose video + current frame only
  // (since exporting the current frame only doesn't really make sense.)
  const setRecordingMode = (mode: RecordingMode): void => {
    _setRecordingMode(mode);
    if (mode === RecordingMode.VIDEO_MP4 && rangeMode === RangeMode.CURRENT) {
      setRangeMode(RangeMode.ALL);
    }
  };

  // Override setIsLoadModalOpen to store the current frame whenever the modal opens.
  // This is so we can reset to it when the modal is closed.
  const setIsLoadModalOpen = (isOpen: boolean): void => {
    if (isOpen) {
      originalFrameRef.current = props.currentFrame;
    }
    _setIsLoadModalOpen(isOpen);
  };

  // Notify parent via props if recording state changes
  const setIsRecording = (isRecording: boolean): void => {
    props.setIsRecording(isRecording);
    _setIsRecording(isRecording);
  };

  // If dataset changes, update the max range field with the total frames.
  useEffect(() => {
    setCustomMax(props.totalFrames - 1);
  }, [props.totalFrames]);

  const getImagePrefix = (): string => {
    if (useDefaultImagePrefix) {
      if (recordingMode === RecordingMode.IMAGE_SEQUENCE) {
        return props.defaultImagePrefix + "-";
      } else {
        return props.defaultImagePrefix;
      }
    } else {
      return imagePrefix;
    }
  };

  //////////////// EVENT HANDLERS ////////////////

  /** Stop any ongoing recordings and reset the current frame, optionally closing the modal. */
  const stopRecording = useCallback(
    (closeModal: boolean) => {
      recorder.current?.abort();
      // Reset the frame number (clean up!)
      props.setFrame(originalFrameRef.current);
      setIsRecording(false);
      recorder.current = null;
      setIsPlayingCloseAnimation(false);
      setPercentComplete(0);
      if (closeModal) {
        setIsLoadModalOpen(false);
      }
    },
    [props.setFrame]
  );

  /**
   * Triggered when the user attempts to cancel or exit the main modal.
   */
  const handleCancel = useCallback(() => {
    // Not recording; exit
    if (!isRecording) {
      setIsLoadModalOpen(false);
      return;
    }

    // Currently recording; user must be prompted to confirm
    modal.confirm({
      title: "Cancel export",
      content: "Are you sure you want to cancel and exit?",
      okText: "Cancel",
      cancelText: "Back",
      centered: true,
      icon: null,
      getContainer: modalContextRef.current || undefined,
      onOk: () => {
        stopRecording(true);
      },
    });
  }, [isRecording, modalContextRef.current, stopRecording]);

  /**
   * Stop the recording without closing the modal.
   */
  const handleStop = useCallback(() => {
    stopRecording(false);
  }, [stopRecording]);

  // Note: This is not wrapped in a useCallback because it has a large number
  // of dependencies, and is likely to update whenever ANY prop or input changes.
  /**
   * Handle the user pressing the Export button and starting a recording.
   */
  const handleStartExport = (): void => {
    if (isRecording) {
      return;
    }
    setIsRecording(true);

    /** Min and max are both inclusive */
    let min: number, max: number;
    switch (rangeMode) {
      case RangeMode.ALL:
        min = 0;
        max = props.totalFrames - 1;
        break;
      case RangeMode.CURRENT:
        min = props.currentFrame;
        max = props.currentFrame;
        break;
      case RangeMode.CUSTOM:
        // Clamp range values in case of unsafe input
        min = clamp(customMin, 0, props.totalFrames - 1);
        max = clamp(customMax, min, props.totalFrames - 1);
    }

    // Copy configuration to options object
    // TODO: Add a callback for when errors are encountered? This can happen if
    // the canvas is unable to fetch an image, such as when a network error occurs.
    const recordingOptions = {
      min: min,
      max: max,
      prefix: getImagePrefix(),
      minDigits: (props.totalFrames - 1).toString().length,
      // Disable download delay for video
      delayMs: recordingMode === RecordingMode.IMAGE_SEQUENCE ? 100 : 0,
      frameIncrement: frameIncrement,
      fps: fps,
      bitrate: videoQuality,
      onCompleted: async () => {
        // Close modal once recording finishes and show completion notification
        setPercentComplete(100);
        notification.success({
          message: "Export complete.",
          placement: "bottomLeft",
          duration: 4,
          icon: <CheckCircleOutlined style={{ color: theme.color.text.success }} />,
        });
        // Close the modal after a small delay so the success notification can be seen
        setIsPlayingCloseAnimation(true);
        setTimeout(() => stopRecording(true), 750);
      },
      onRecordedFrame: (frame: number) => {
        // Update the progress bar as frames are recorded.
        setPercentComplete(Math.floor(((frame - min) / (max - min)) * 100));
      },
    };

    // Initialize different recorders based on the provided options.
    switch (recordingMode) {
      case RecordingMode.VIDEO_MP4:
        recorder.current = new WebCodecsMp4Recorder(props.setFrame, props.getCanvas, recordingOptions);
        break;
      case RecordingMode.IMAGE_SEQUENCE:
      default:
        recorder.current = new ImageSequenceRecorder(props.setFrame, props.getCanvas, recordingOptions);
        break;
    }
    recorder.current.start();
  };

  //////////////// RENDERING ////////////////

  const videoQualityOptions = [
    { label: "High", value: VideoBitrate.HIGH },
    { label: "Med", value: VideoBitrate.MEDIUM },
    { label: "Low", value: VideoBitrate.LOW },
  ];

  const isWebCodecsEnabled = WebCodecsMp4Recorder.isSupported();
  const customRangeFrames = Math.max(Math.ceil((customMax - customMin + 1) / frameIncrement), 1);

  const totalFrames = rangeMode === RangeMode.CUSTOM ? customRangeFrames : props.totalFrames;
  const totalSeconds = totalFrames / fps;

  // Gets the total duration as a MM min, SS sec label.
  // Also adds decimal places for small durations.
  const getDurationLabel = (): string => {
    const durationMin = Math.floor(totalSeconds / 60);
    const durationSec = totalSeconds - durationMin * 60;

    let timestamp = "";
    if (durationMin > 0) {
      timestamp += durationMin.toString() + " min, ";
    }
    // Format seconds to hundredths
    if (durationMin === 0 && durationSec < 10) {
      // Round to hundredths
      const roundedSeconds = Math.round(durationSec * 100) / 100;
      timestamp += roundedSeconds.toFixed(2) + " sec";
    } else {
      timestamp += Math.floor(durationSec).toString() + " sec";
    }
    return timestamp;
  };

  const getApproximateVideoFilesizeMb = (): number => {
    // From experimentation, filesize is independent of fps.
    // It scales linearly with the bitrate until a maximum bitrate is hit,
    // which seems to depend on the video dimensions.

    // These are more or less magic numbers based on the dataset I'm testing with,
    // but they're good enough for giving an order of magnitude range of the resulting filesize.
    const maxVideoBits = (totalFrames * videoQuality) / 25;

    const bitsPerFrame = props.getCanvas().width * props.getCanvas().height * 10e3;
    const constrainedBitRate = bitsPerFrame / 4;

    return Math.min(maxVideoBits, constrainedBitRate) / 10e6;
  };

  // Footer for the Export modal.
  // Layout: Optional Progress meter - Export/Stop Button - Cancel Button
  const modalFooter = (
    <HorizontalDiv style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
      {(percentComplete !== 0 || isRecording) && (
        <Tooltip title={percentComplete + "%"} style={{ verticalAlign: "middle" }}>
          <Progress
            style={{ marginRight: "8px", verticalAlign: "middle" }}
            type="circle"
            size={theme.controls.heightSmall - 6}
            percent={percentComplete}
            showInfo={false}
            strokeColor={percentComplete === 100 ? theme.color.text.success : theme.color.theme}
            strokeWidth={12}
          />
        </Tooltip>
      )}
      <Button
        type={isRecording ? "default" : "primary"}
        onClick={isRecording ? handleStop : handleStartExport}
        data-testid={TEST_ID_EXPORT_ACTION_BUTTON}
        style={{ width: "76px" }}
        disabled={isPlayingCloseAnimation}
      >
        {isRecording ? "Stop" : "Export"}
      </Button>
      <Button onClick={handleCancel} style={{ width: "76px" }} disabled={isPlayingCloseAnimation}>
        {isRecording ? "Cancel" : "Close"}
      </Button>
    </HorizontalDiv>
  );

  return (
    <div ref={modalContextRef}>
      {/* Export button */}
      <Button
        type="primary"
        onClick={() => setIsLoadModalOpen(true)}
        disabled={props.disabled}
        data-testid={TEST_ID_OPEN_EXPORT_MODAL_BUTTON}
      >
        Export
      </Button>

      {/* Export modal */}
      <Modal
        title={"Export"}
        open={isLoadModalOpen}
        onCancel={handleCancel}
        cancelButtonProps={{ hidden: true }}
        centered={true}
        // Don't allow cancellation of modal by clicking off it when the recording is happening
        maskClosable={!isRecording}
        getContainer={modalContextRef.current || undefined}
        footer={modalFooter}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "20px", marginTop: "15px" }}>
          {/* Recording Mode radio */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <ExportModeRadioGroup
              value={recordingMode}
              buttonStyle="solid"
              optionType="button"
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "center",
                width: "100%",
              }}
              onChange={(e) => setRecordingMode(e.target.value)}
            >
              <CustomRadio value={RecordingMode.IMAGE_SEQUENCE}>PNG image sequence</CustomRadio>
              <CustomRadio value={RecordingMode.VIDEO_MP4} disabled={!isWebCodecsEnabled}>
                {/* Optional tooltip here in case WebCodecs API is not enabled. */}
                <Tooltip
                  title={"Video recording isn't supported by this browser."}
                  open={isWebCodecsEnabled ? false : undefined}
                >
                  MP4 video
                </Tooltip>
              </CustomRadio>
            </ExportModeRadioGroup>
          </div>

          {/* Radio options (All/Current Frame/Custom) */}
          <Card size="small">
            <Radio.Group
              value={rangeMode}
              onChange={(e: RadioChangeEvent) => {
                setRangeMode(e.target.value);
              }}
              disabled={isRecording}
            >
              <Space direction="vertical">
                <Radio value={RangeMode.ALL}>
                  All frames{" "}
                  {rangeMode === RangeMode.ALL && (
                    <span style={{ color: theme.color.text.hint, marginLeft: "4px" }}>
                      ({props.totalFrames} frames total)
                    </span>
                  )}
                </Radio>
                <Radio value={RangeMode.CURRENT} disabled={recordingMode === RecordingMode.VIDEO_MP4}>
                  Current frame only
                </Radio>
                <Radio value={RangeMode.CUSTOM}>Custom range</Radio>

                {rangeMode === RangeMode.CUSTOM ? (
                  // Render the custom range input in the radio list if selected
                  <VerticalDiv style={{ paddingLeft: "25px" }}>
                    <CustomRangeDiv>
                      <p>Range:</p>
                      <InputNumber
                        aria-label="min frame"
                        controls={false}
                        min={0}
                        max={props.totalFrames - 1}
                        value={customMin}
                        onChange={(value) => value && setCustomMin(value)}
                        disabled={isRecording}
                      />
                      <p>-</p>
                      <InputNumber
                        aria-label="max frame"
                        controls={false}
                        min={customMin}
                        max={props.totalFrames - 1}
                        value={customMax}
                        onChange={(value) => value && setCustomMax(value)}
                        disabled={isRecording}
                      />
                      <p>of {props.totalFrames - 1}</p>
                    </CustomRangeDiv>
                    <HorizontalDiv>
                      <p>Frame increment:</p>
                      <SpinBox
                        value={frameIncrement}
                        onChange={setFrameIncrement}
                        min={1}
                        max={props.totalFrames - 1}
                      />
                      <p style={{ color: theme.color.text.hint }}>({customRangeFrames} frames total)</p>
                    </HorizontalDiv>
                  </VerticalDiv>
                ) : null}
              </Space>
            </Radio.Group>
          </Card>

          {recordingMode === RecordingMode.VIDEO_MP4 && (
            <Card size="small" title={<p>Video settings</p>}>
              <VerticalDiv>
                <HorizontalDiv>
                  <p>FPS:</p>
                  <SpinBox value={fps} onChange={setFps} min={1} max={120} disabled={isRecording} />
                  <p style={{ color: theme.color.text.hint }}>({getDurationLabel()})</p>
                </HorizontalDiv>
                <HorizontalDiv>
                  <p>Video quality:</p>
                  <CustomRadioGroup
                    disabled={isRecording}
                    options={videoQualityOptions}
                    optionType="button"
                    value={videoQuality}
                    onChange={(e) => setVideoQuality(e.target.value)}
                  />
                  <p style={{ color: theme.color.text.hint }}>(~{Math.round(getApproximateVideoFilesizeMb())} MB)</p>
                </HorizontalDiv>
              </VerticalDiv>
            </Card>
          )}

          <div>
            <p>Helpful tips:</p>
            <div style={{ paddingLeft: "4px" }}>
              <p>1. Set your default download location </p>
              <p>2. Turn off "Ask where to save each file before downloading" in your browser settings</p>
              <p>3. For best results, keep this page open while recording</p>
            </div>
          </div>

          {/* Filename prefix */}
          <HorizontalDiv style={{ flexWrap: "nowrap" }}>
            <label style={{ width: "100%" }}>
              <p>{recordingMode === RecordingMode.IMAGE_SEQUENCE ? "Prefix:" : "Filename:"}</p>
              <Input
                onChange={(event) => {
                  setImagePrefix(event.target.value);
                  setUseDefaultImagePrefix(false);
                }}
                size="small"
                value={getImagePrefix()}
                disabled={isRecording}
              />
            </label>
            <p>{recordingMode === RecordingMode.IMAGE_SEQUENCE ? "#.png" : ".mp4"}</p>
            <Button
              disabled={isRecording || useDefaultImagePrefix}
              onClick={() => {
                setUseDefaultImagePrefix(true);
              }}
            >
              Reset
            </Button>
          </HorizontalDiv>
        </div>
      </Modal>
    </div>
  );
}
