import { Button, Modal, Input, Radio, Space, RadioChangeEvent, InputNumber, App, Progress, Tooltip } from "antd";
import React, { ReactElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import SpinBox from "./SpinBox";
import { RecordingOptions } from "../colorizer/RecordingControls";
import { AppThemeContext } from "./AppStyle";
import { CheckCircleOutlined } from "@ant-design/icons";

type ExportButtonProps = {
  totalFrames: number;
  setFrame: (frame: number) => void;
  currentFrame: number;
  startRecording: (options: Partial<RecordingOptions>) => void;
  stopRecording: () => void;
  defaultImagePrefix?: string;
  disabled?: boolean;
};

export const TEST_ID_EXPORT_ACTION_BUTTON = "export-action";
export const TEST_ID_OPEN_EXPORT_MODAL_BUTTON = "open-export-modal";

const defaultProps: Partial<ExportButtonProps> = {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(value, min));
}

/**
 * A single Export button that opens up an export modal when clicked. Manages starting and stopping
 * an image sequence recording, resetting state when complete.
 */
export default function ExportButton(inputProps: ExportButtonProps): ReactElement {
  const props = { ...defaultProps, ...inputProps } as Required<ExportButtonProps>;

  const theme = useContext(AppThemeContext);

  const enum ExportMode {
    ALL,
    CURRENT,
    CUSTOM,
  }

  // Static convenience method for creating simple modals + notifications.
  // Used here for the cancel modal and the success notification.
  // Note: notification API seems to only place notifications at the top-level under the
  // <body> tag, which causes some issues with styling.
  const { modal, notification } = App.useApp();
  const modalContextRef = useRef<HTMLDivElement>(null);

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [exportMode, setExportMode] = useState(ExportMode.ALL);
  const [customMin, setCustomMin] = useState(0);
  const [customMax, setCustomMax] = useState(props.totalFrames - 1);
  const [imagePrefix, setImagePrefix] = useState(props.defaultImagePrefix);
  const [useDefaultImagePrefix, setUseDefaultImagePrefix] = useState(true);
  const [frameIncrement, setFrameIncrement] = useState(1);

  const [originalFrame, setOriginalFrame] = useState(props.currentFrame);
  const [percentComplete, setPercentComplete] = useState(0);

  // If dataset changes, update the max range field with the total frames.
  useEffect(() => {
    setCustomMax(props.totalFrames - 1);
  }, [props.totalFrames]);

  useEffect(() => {
    if (useDefaultImagePrefix) {
      setImagePrefix(props.defaultImagePrefix);
    }
  }, [props.defaultImagePrefix, useDefaultImagePrefix]);

  // Store the current frame whenever the modal opens so we can reset to it when
  // the modal is closed.
  useEffect(() => {
    setOriginalFrame(props.currentFrame);
  }, [isLoadModalOpen]);

  /** Stop any ongoing recordings and reset the current frame, optionally closing the modal. */
  const stopRecording = useCallback((resetFrame: number, closeModal: boolean) => {
    // Reset the frame number (clean up!)
    props.setFrame(resetFrame);
    setIsRecording(false);
    if (closeModal) {
      setIsLoadModalOpen(false);
      setPercentComplete(0);
    }
  }, []);

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
      content: "Are you sure you want to cancel the recording?",
      okText: "Cancel",
      cancelText: "Back",
      centered: true,
      icon: null,
      getContainer: modalContextRef.current || undefined,
      onOk: () => {
        props.stopRecording();
        stopRecording(originalFrame, true);
      },
    });
  }, [isRecording, modalContextRef.current, stopRecording, props.stopRecording]);

  /**
   * Stop the recording without closing the modal.
   */
  const handleStop = useCallback(() => {
    modal.confirm({
      title: "Stop export",
      content: "Are you sure you want to stop the recording?",
      okText: "Stop",
      cancelText: "Back",
      centered: true,
      icon: null,
      getContainer: modalContextRef.current || undefined,
      onOk: () => {
        props.stopRecording();
        props.setFrame(originalFrame);
        setIsRecording(false);
        setPercentComplete(0);
      },
    });
  }, []);

  /**
   * Handle the user pressing the Export button and starting a recording.
   *
   * Note: This is not wrapped in a useCallback because it has a large number
   * of dependencies, and is likely to update whenever any prop or input changes.
   */
  const handleStartExport = (): void => {
    if (isRecording) {
      return;
    }
    setIsRecording(true);

    /** Min and max are both inclusive */
    let min: number, max: number;
    switch (exportMode) {
      case ExportMode.ALL:
        min = 0;
        max = props.totalFrames - 1;
        break;
      case ExportMode.CURRENT:
        min = props.currentFrame;
        max = props.currentFrame;
        break;
      case ExportMode.CUSTOM:
        // Clamp range values in case of unsafe input
        min = clamp(customMin, 0, props.totalFrames - 1);
        max = clamp(customMax, min, props.totalFrames - 1);
    }

    // Start the recording
    props.startRecording({
      min: min,
      max: max,
      prefix: imagePrefix,
      minDigits: (props.totalFrames - 1).toString().length,
      frameIncrement: frameIncrement,
      onCompletedCallback: () => {
        // Close modal once recording finishes and show completion notification
        notification.success({
          message: "Export complete.",
          placement: "bottomLeft",
          duration: 4,
          icon: <CheckCircleOutlined style={{ color: theme.color.text.success }} />,
        });
        stopRecording(originalFrame, true);
      },
      onRecordedFrameCallback: (frame: number) => {
        // Update the progress bar as frames are recorded.
        setPercentComplete(Math.floor(((frame - min) / (max - min)) * 100));
      },
    });
  };

  const numExportedFrames = Math.max(Math.ceil((customMax - customMin + 1) / frameIncrement), 1);

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
        title={"Export image sequence"}
        open={isLoadModalOpen}
        onCancel={handleCancel}
        cancelButtonProps={{ hidden: true }}
        centered={true}
        // Don't allow cancellation of modal by clicking off it when the recording is happening
        maskClosable={!isRecording}
        getContainer={modalContextRef.current || undefined}
        footer={
          // Layout: Optional Progress meter - Export/Stop Button - Cancel Button
          <HorizontalDiv style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
            {(percentComplete !== 0 || isRecording) && (
              <Tooltip title={percentComplete + "%"} style={{ verticalAlign: "middle" }}>
                <Progress
                  style={{ marginRight: "8px", verticalAlign: "middle" }}
                  type="circle"
                  size={theme.controls.heightSmall - 6}
                  percent={percentComplete}
                  showInfo={false}
                  strokeColor={theme.color.theme}
                  strokeWidth={12}
                />
              </Tooltip>
            )}
            <Button
              type="primary"
              onClick={isRecording ? () => handleStop() : handleStartExport}
              data-testid={TEST_ID_EXPORT_ACTION_BUTTON}
              style={{ width: "76px" }}
            >
              {isRecording ? "Stop" : "Export"}
            </Button>
            <Button onClick={handleCancel} style={{ width: "76px" }}>
              Cancel
            </Button>
          </HorizontalDiv>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "20px" }}>
          <Radio.Group
            value={exportMode}
            onChange={(e: RadioChangeEvent) => {
              setExportMode(e.target.value);
            }}
            disabled={isRecording}
          >
            <Space direction="vertical">
              <Radio value={ExportMode.ALL}>
                All frames{" "}
                {exportMode === ExportMode.ALL && (
                  <span style={{ color: theme.color.text.hint, marginLeft: "4px" }}>
                    ({props.totalFrames} frames total)
                  </span>
                )}
              </Radio>
              <Radio value={ExportMode.CURRENT}>Current frame only</Radio>
              <Radio value={ExportMode.CUSTOM}>Custom</Radio>
              {exportMode === ExportMode.CUSTOM ? (
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
                    <p>Frame Increment:</p>
                    <SpinBox value={frameIncrement} onChange={setFrameIncrement} min={1} max={props.totalFrames - 1} />
                    <p style={{ color: theme.color.text.hint }}>({numExportedFrames} frames total)</p>
                  </HorizontalDiv>
                </VerticalDiv>
              ) : null}
            </Space>
          </Radio.Group>

          <div>
            <p>Helpful tips:</p>
            <div style={{ paddingLeft: "4px" }}>
              <p>1. Set your default download location </p>
              <p>2. Turn off "Ask where to save each file before downloading" in your browser settings</p>
            </div>
          </div>

          <HorizontalDiv style={{ flexWrap: "nowrap" }}>
            <label style={{ width: "100%" }}>
              <p>Prefix:</p>
              <Input
                onChange={(event) => {
                  setImagePrefix(event.target.value);
                  setUseDefaultImagePrefix(false);
                }}
                size="small"
                value={imagePrefix}
                disabled={isRecording}
              />
            </label>
            <p>#.png</p>
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
