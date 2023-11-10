import { Button, Dropdown, Input, InputRef, MenuProps, Modal, Space } from "antd";
import React, { ReactElement, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useClickAnyWhere, useLocalStorage } from "usehooks-ts";

import { AppThemeContext } from "./AppStyle";
import { DEFAULT_COLLECTION_FILENAME, DEFAULT_COLLECTION_PATH } from "../constants";

/** Key for local storage to read/write recently opened datasets */
const RECENT_DATASETS_STORAGE_KEY = "recentDatasets";
const MAX_RECENT_DATASETS = 10;

type RecentDataset = {
  url: string;
  label: string;
};

type LoadDatasetButtonProps = {
  /**
   * Callback for when a URL is requested to be loaded.
   * @param url The string URL, as typed into the URL input field.
   * @returns a Promise object resolving to the absolute path of the resource.
   */
  onRequestLoad: (url: string) => Promise<string>;
};

const defaultProps: Partial<LoadDatasetButtonProps> = {};

/** Mocks the styling of a Dropdown menu, because Ant Dropdown does not let us directly
 * insert elements into the menu. We have to create a wrapper element to make it look
 * like a single dropdown.
 */
const DropdownContentContainer = styled.div`
  position: absolute;
  background-color: var(--color-background);
  border-radius: var(--radius-control-small);
  box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05);

  padding-top: 6px;

  & > ul.ant-dropdown-menu {
    // Disable the real dropdown's styling
    box-shadow: transparent 0 0 !important;
    background-color: transparent;
  }
`;

export default function LoadDatasetButton(props: LoadDatasetButtonProps): ReactElement {
  props = { ...defaultProps, ...props };

  const theme = useContext(AppThemeContext);
  const modalContextRef = useRef<HTMLDivElement>(null);
  const dropdownContextRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // STATE ////////////////////////////////////////////////////////////

  // Directly control the visibility of the recent datasets dropdown because
  // Ant's default behavior has some bugs (the menu will appear and disappear
  // suddenly) if trying to temporarily disable visibility.
  const [showRecentDropdown, setShowRecentDropdown] = useState(false);
  const [urlInput, _setUrlInput] = useState("");
  // Clear the dropdown when user starts typing
  const setUrlInput = useCallback((newUrl: string) => {
    setShowRecentDropdown(false);
    _setUrlInput(newUrl);
  }, []);

  const defaultDataset = DEFAULT_COLLECTION_PATH + "/" + DEFAULT_COLLECTION_FILENAME;
  const [recentDatasets, setRecentDatasets] = useLocalStorage<RecentDataset[]>(RECENT_DATASETS_STORAGE_KEY, [
    {
      url: defaultDataset,
      label: defaultDataset,
    },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string>("");

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  // BEHAVIOR ////////////////////////////////////////////////////////////

  useEffect(() => {
    if (isLoadModalOpen) {
      // Clear modal when opening
      // TODO: This does not actually stop the underlying load operation. Could cause the interface to act
      // unexpectedly, but maybe not a huge problem because there's a ~4s timeout on the load operation anyways.
      setIsLoading(false);
      setErrorText("");
    }
  }, [isLoadModalOpen]);

  // The dropdown should be shown whenever the user clicks on the input field, and hidden if the user starts
  // typing or clicks off of the input (including clicking options).
  useClickAnyWhere((event) => {
    if (event.target === inputRef.current?.input) {
      setShowRecentDropdown(true);
    } else {
      setShowRecentDropdown(false);
    }
  });

  const handleLoadClicked = useCallback(async (): Promise<void> => {
    if (urlInput === "") {
      setErrorText("Please enter a URL!");
      return;
    }
    if (window.location.protocol === "https:" && urlInput.trim().startsWith("http:")) {
      setErrorText(
        "Cannot load a HTTP resource from an HTTPS site. Please move your dataset so it is served over HTTPS, or install and run this project locally."
      );
      return;
    }
    if (isLoading) {
      return;
    }
    setIsLoading(true);
    props.onRequestLoad(urlInput).then(
      (loadedUrl) => {
        // Add a slight delay before closing and resetting the modal for a smoother experience
        setTimeout(() => {
          setIsLoadModalOpen(false);
          setIsLoading(false);
          // Add to recent datasets
          // Check if we have this dataset already in our recent datasets. Match with the resource URL
          // because there is some ambiguity in user input, since we accept both filenames and directories.
          const newRecentDataset: RecentDataset = {
            url: loadedUrl,
            label: urlInput,
          };
          const datasetIndex = recentDatasets.findIndex(({ url }) => url === loadedUrl);
          if (datasetIndex === -1) {
            // New dataset, add to front while maintaining max length
            setRecentDatasets([newRecentDataset, ...recentDatasets.slice(0, MAX_RECENT_DATASETS - 1)]);
          } else {
            // Move to front; this also updates the label if it changed.
            setRecentDatasets([
              newRecentDataset,
              ...recentDatasets.slice(0, datasetIndex),
              ...recentDatasets.slice(datasetIndex + 1),
            ]);
          }
          setErrorText("");
          setUrlInput("");
        }, 500);
        return;
      },
      (reason) => {
        // failed
        if (reason && reason.toString().includes("AbortError")) {
          setErrorText(
            "Timeout: The server took too long to respond. Please check if the file server is online and try again."
          );
        } else {
          setErrorText(
            reason.toString() ||
              "The dataset(s) could not be loaded with the URL provided. Please check it and try again."
          );
        }
        setIsLoading(false);
      }
    );
  }, [urlInput, props.onRequestLoad]);

  const handleCancel = useCallback(() => {
    // should this cancel dataset loading mid-load?
    setIsLoading(false);
    setErrorText("");
    setIsLoadModalOpen(false);
    setShowRecentDropdown(false);
  }, []);

  // RENDERING ////////////////////////////////////////////////////////

  const datasetsDropdownItems = recentDatasets.map(({ url, label }) => {
    return {
      key: url,
      label: label,
    };
  });

  const renderDropdown = (menu: ReactNode): React.JSX.Element => (
    // Add a fake container around this so we can include a text label
    <DropdownContentContainer>
      <span style={{ paddingLeft: "16px", color: theme.color.text.hint }}>Recent datasets:</span>
      {menu}
    </DropdownContentContainer>
  );

  const datasetsDropdownProps: MenuProps = {
    onClick: (info) => {
      setUrlInput(info.key);
    },
    items: datasetsDropdownItems,
  };

  return (
    <div ref={modalContextRef}>
      <Button type="primary" onClick={() => setIsLoadModalOpen(true)}>
        Load
      </Button>
      <Modal
        title={"Load a single dataset or collection"}
        open={isLoadModalOpen}
        onCancel={handleCancel}
        getContainer={modalContextRef.current || undefined}
        afterOpenChange={(open) => open && inputRef.current?.focus({ cursor: "all" })}
        footer={<Button onClick={handleCancel}>Cancel</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ marginBottom: "10px" }}>
            Load a collection of datasets or a single dataset by providing its URL.
          </p>

          <div ref={dropdownContextRef} style={{ position: "relative" }}>
            <div style={{ display: "flex", flexDirection: "row", gap: "6px" }}>
              <Space.Compact style={{ width: "100%" }}>
                <Dropdown
                  trigger={["click"]}
                  menu={datasetsDropdownProps}
                  placement="bottomLeft"
                  open={showRecentDropdown}
                  getPopupContainer={dropdownContextRef.current ? () => dropdownContextRef.current! : undefined}
                  dropdownRender={renderDropdown}
                >
                  <Input
                    placeholder="https://example.com/collection.json"
                    value={urlInput}
                    ref={inputRef}
                    onChange={(event) => setUrlInput(event.target.value)}
                    allowClear
                    disabled={isLoading}
                  />
                </Dropdown>
                <Button type="primary" onClick={handleLoadClicked} loading={isLoading}>
                  Load
                </Button>
              </Space.Compact>
            </div>
            <p>
              <i>
                <span style={{ color: theme.color.text.hint }}>Click for recent datasets</span>
              </i>
            </p>
          </div>

          {errorText && (
            <p>
              <span style={{ color: theme.color.text.error }}>{errorText}</span>
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
