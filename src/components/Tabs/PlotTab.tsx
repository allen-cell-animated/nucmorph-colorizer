import { SearchOutlined } from "@ant-design/icons";
import { Input } from "antd";
import React, { ReactElement } from "react";
import styled from "styled-components";

import { Dataset, Track } from "../../colorizer";
import { FlexRowAlignCenter, NoSpinnerContainer } from "../../styles/utils";

import { FeatureData } from "../../colorizer/Dataset";
import IconButton from "../IconButton";
import PlotWrapper from "../PlotWrapper";

const TrackTitleBar = styled(FlexRowAlignCenter)`
  justify-content: end;
  flex-wrap: wrap;
`;

const TrackSearch = styled(FlexRowAlignCenter)`
  & input {
    max-width: 80px;
  }

  & h3 {
    margin: 0;
  }
`;

type PlotTabProps = {
  findTrackInputText: string;
  setFindTrackInputText: (text: string) => void;
  findTrack: (trackId: number, seekToFrame?: boolean) => void;
  currentFrame: number;
  dataset: Dataset | null;
  featureData: FeatureData | null;
  selectedTrack: Track | null;
  disabled: boolean;
};

export default function PlotTab(props: PlotTabProps): ReactElement {
  const searchForTrack = (): void => {
    if (props.findTrackInputText === "") {
      return;
    }
    props.findTrack(parseInt(props.findTrackInputText, 10));
  };

  return (
    <>
      <TrackTitleBar>
        <NoSpinnerContainer>
          <TrackSearch $gap={6}>
            <h3>Search</h3>
            <Input
              type="number"
              value={props.findTrackInputText}
              size="small"
              placeholder="Track ID..."
              disabled={props.disabled}
              onChange={(event) => {
                props.setFindTrackInputText(event.target.value);
              }}
              onPressEnter={searchForTrack}
            />
            <IconButton disabled={props.disabled} onClick={searchForTrack}>
              <SearchOutlined />
            </IconButton>
          </TrackSearch>
        </NoSpinnerContainer>
      </TrackTitleBar>
      <PlotWrapper
        frame={props.currentFrame}
        dataset={props.dataset}
        featureData={props.featureData}
        selectedTrack={props.selectedTrack}
      />
    </>
  );
}
