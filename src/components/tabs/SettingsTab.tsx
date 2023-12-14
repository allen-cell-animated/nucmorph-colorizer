import { Checkbox } from "antd";
import React, { ReactElement } from "react";
import { Color } from "three";

import { DrawMode } from "../../colorizer/ColorizeCanvas";
import { FlexColumn } from "../../styles/utils";
import { DrawSettings } from "../CanvasWrapper";
import DrawModeDropdown from "../DrawModeDropdown";

type SettingsTabProps = {
  outOfRangeDrawSettings: DrawSettings;
  outlierDrawSettings: DrawSettings;
  showScaleBar: boolean;
  showTimestamp: boolean;
  setOutOfRangeDrawSettings: (drawSettings: DrawSettings) => void;
  setOutlierDrawSettings: (drawSettings: DrawSettings) => void;
  setShowScaleBar: (show: boolean) => void;
  setShowTimestamp: (show: boolean) => void;
};

export default function SettingsTab(props: SettingsTabProps): ReactElement {
  return (
    <FlexColumn $gap={5}>
      <DrawModeDropdown
        label="Filtered out values"
        selected={props.outOfRangeDrawSettings.mode}
        color={props.outOfRangeDrawSettings.color}
        onChange={(mode: DrawMode, color: Color) => {
          props.setOutOfRangeDrawSettings({ mode, color });
        }}
      />
      <DrawModeDropdown
        label="Outliers"
        selected={props.outlierDrawSettings.mode}
        color={props.outlierDrawSettings.color}
        onChange={(mode: DrawMode, color: Color) => {
          props.setOutlierDrawSettings({ mode, color });
        }}
      />
      <Checkbox
        type="checkbox"
        checked={props.showScaleBar}
        onChange={() => {
          props.setShowScaleBar(!props.showScaleBar);
        }}
      >
        Show scale bar
      </Checkbox>
      <Checkbox
        type="checkbox"
        checked={props.showTimestamp}
        onChange={() => {
          props.setShowTimestamp(!props.showTimestamp);
        }}
      >
        Show timestamp
      </Checkbox>
    </FlexColumn>
  );
}
