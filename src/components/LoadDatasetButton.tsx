import { FolderOpenOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, InputRef, MenuProps, Space } from "antd";
import { MenuItemType } from "antd/es/menu/hooks/useItems";
import React, { ReactElement, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useClickAnyWhere } from "usehooks-ts";

import { Dataset } from "../colorizer";
import { openDirectory } from "../colorizer/utils/file";
import { useRecentCollections } from "../colorizer/utils/react_utils";
import { convertAllenPathToHttps, isAllenPath } from "../colorizer/utils/url_utils";
import { FlexRowAlignCenter } from "../styles/utils";

import Collection from "../colorizer/Collection";
import { AppThemeContext } from "./AppStyle";
import TextButton from "./Buttons/TextButton";
import StyledModal from "./Modals/StyledModal";

type LoadDatasetButtonProps = {
  /**
   * Callback when a dataset was successfully loaded.
   * @param collection
   * @param dataset
   * @returns
   */
  onLoad: (collection: Collection, datasetKey: string, dataset: Dataset) => void;
  /** The URL of the currently loaded resource, used to indicate it on the recent datasets dropdown. */
  currentResourceUrl: string;
};

const defaultProps: Partial<LoadDatasetButtonProps> = {};

/** Mocks the styling of a Dropdown menu, because Ant Dropdown does not let us directly
 * insert elements into the menu. We have to create a wrapper element to make it look
 * like a single dropdown.
 */
const DropdownContentContainer = styled.div`
  position: absolute;
  width: max-content;
  max-width: 80vw;
  background-color: var(--color-background);
  border-radius: var(--radius-control-small);
  box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05);

  padding-top: 6px;

  & > ul.ant-dropdown-menu {
    // Disable the real dropdown's styling
    box-shadow: transparent 0 0 !important;
    background-color: transparent;
  }

  & .ant-dropdown-menu-item {
    width: 100%;
    overflow: hidden;
  }

  & .ant-dropdown-menu-item:not(:last-child) {
    margin-bottom: 4px;
  }
`;

export default function LoadDatasetButton(props: LoadDatasetButtonProps): ReactElement {
  props = { ...defaultProps, ...props };

  const theme = useContext(AppThemeContext);
  const dropdownContextRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // STATE ////////////////////////////////////////////////////////////

  // Directly control the visibility of the recent datasets dropdown because
  // Ant's default behavior has some bugs (the menu will appear and disappear
  // suddenly) if trying to temporarily disable visibility.
  const [showRecentDropdown, setShowRecentDropdown] = useState(false);
  const [urlInput, _setUrlInput] = useState("");
  // Wrap `setUrlInput` so we clear the dropdown when user starts typing
  const setUrlInput = useCallback((newUrl: string) => {
    setShowRecentDropdown(false);
    _setUrlInput(newUrl);
  }, []);

  const [recentCollections, registerCollection] = useRecentCollections();

  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string>("");

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  const [totalFiles, setTotalFiles] = useState(0);
  const [loadedFiles, setLoadedFiles] = useState(0);
  const totalFilesRef = useRef(0);
  const loadedFilesRef = useRef(0);

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
  // typing or clicks off of the input (including selecting options in the dropdown).
  // TODO: Switch to using AccessibleDropdown as a base component
  useClickAnyWhere((event) => {
    if (event.target === inputRef.current?.input) {
      setShowRecentDropdown(true);
    } else {
      setShowRecentDropdown(false);
    }
  });

  /**
   * Attempt to load a URL and return the resource path, the loaded collection, and the loaded dataset.
   * The URL can either be a collection or a dataset, so handle it as an ambiguous URL.
   * @throws an error if the URL could not be loaded.
   * @returns an array, containing:
   *   - the loaded collection
   *   - the loaded dataset
   */
  const handleLoadRequest = async (url: string): Promise<[string, Collection, Dataset]> => {
    console.log("Loading '" + url + "'.");
    const newCollection = await Collection.loadFromAmbiguousUrl(url);
    const newDatasetKey = newCollection.getDefaultDatasetKey();
    const loadResult = await newCollection.tryLoadDataset(newDatasetKey);
    if (!loadResult.loaded) {
      const errorMessage = loadResult.errorMessage;

      if (errorMessage) {
        // Remove 'Error:' prefixes
        const matches = errorMessage.replace(/^(Error:)*/, "");
        // Reject the promise with the error message
        throw new Error(matches);
      } else {
        throw new Error();
      }
    }

    const resourceUrl = newCollection.url || newCollection.getDefaultDatasetKey();
    return [resourceUrl, newCollection, loadResult.dataset];
  };

  const handleLoadClicked = useCallback(async (): Promise<void> => {
    if (urlInput === "") {
      setErrorText("Please enter a URL!");
      return;
    }
    let formattedUrlInput = urlInput.trim();
    // Check if the URL is an allen resource. If so, attempt to convert it.
    if (isAllenPath(formattedUrlInput)) {
      const convertedUrl = convertAllenPathToHttps(formattedUrlInput);
      if (!convertedUrl) {
        setErrorText(
          "The provided filestore path cannot be loaded directly. Please check that the path is correct! Alternatively, move your dataset so it is served over HTTPS."
        );
        return;
      }
      formattedUrlInput = convertedUrl;
    }

    if (window.location.protocol === "https:" && formattedUrlInput.startsWith("http:")) {
      setErrorText(
        "Cannot load a HTTP resource from an HTTPS site. Please move your dataset so it is served over HTTPS, or install and run this project locally."
      );
      return;
    }
    if (isLoading) {
      return;
    }
    setIsLoading(true);

    handleLoadRequest(formattedUrlInput).then(
      ([loadedUrl, collection, dataset]) => {
        props.onLoad(collection, collection.getDefaultDatasetKey(), dataset);

        // Add a slight delay before closing and resetting the modal for a smoother experience
        setTimeout(() => {
          setIsLoadModalOpen(false);
          setIsLoading(false);
          // Add to recent collections
          registerCollection({
            url: loadedUrl,
            label: urlInput, // Use raw url input for the label
          });
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
  }, [urlInput, props.onLoad]);

  const handleCancel = useCallback(() => {
    // should this cancel datasets/collection loading mid-load?
    setIsLoading(false);
    setErrorText("");
    setIsLoadModalOpen(false);
    setShowRecentDropdown(false);
  }, []);

  // RENDERING ////////////////////////////////////////////////////////

  const collectionsDropdownItems: MenuItemType[] = recentCollections.map(({ url, label }) => {
    const isCurrentUrl = props.currentResourceUrl === url;
    return {
      key: url,
      label: label,
      style: isCurrentUrl ? { color: "var(--color-text-hint)" } : undefined,
      icon: isCurrentUrl ? <FolderOpenOutlined /> : undefined,
    };
  });

  // Get the URLs (keys) of any recent collections that match the currently selected urlInput.
  const matchingKeys = recentCollections.filter(({ label }) => label === urlInput).map(({ url }) => url);
  const collectionsDropdownProps: MenuProps = {
    onClick: (info) => {
      // Set the URL input to the label of the selected collection
      const collection = recentCollections.find(({ url }) => url === info.key);
      if (collection) {
        setUrlInput(collection.label ?? collection.url);
      }
    },
    items: collectionsDropdownItems,
    selectable: true,
    selectedKeys: matchingKeys,
  };

  const renderDropdown = (menu: ReactNode): React.JSX.Element => (
    // Add a fake container around this so we can include a text label ("Recent datasets")
    <DropdownContentContainer>
      <span style={{ paddingLeft: "16px", color: theme.color.text.hint }}>Recent datasets:</span>
      {menu}
    </DropdownContentContainer>
  );

  const isRecentDropdownEmpty = recentCollections.length === 0;

  return (
    <div>
      <TextButton onClick={() => setIsLoadModalOpen(true)}>
        <UploadOutlined />
        <p>Load</p>
      </TextButton>
      <StyledModal
        title={"Load a single dataset or collection"}
        open={isLoadModalOpen}
        onCancel={handleCancel}
        afterOpenChange={(open) => open && inputRef.current?.focus({ cursor: "all" })}
        footer={<Button onClick={handleCancel}>Cancel</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ marginBottom: "10px" }}>Load a collection of datasets or a single dataset by providing a URL.</p>

          <div ref={dropdownContextRef} style={{ position: "relative" }}>
            <p>
              <i>
                <span style={{ color: theme.color.text.hint }}> Click below to show recent datasets</span>
              </i>
            </p>
            <div style={{ display: "flex", flexDirection: "row", gap: "6px" }}>
              <Space.Compact style={{ width: "100%" }}>
                <Dropdown
                  trigger={["click"]}
                  menu={collectionsDropdownProps}
                  placement="bottomLeft"
                  open={showRecentDropdown && !isRecentDropdownEmpty}
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
            <FlexRowAlignCenter $gap={8} style={{ margin: "5px 0px" }}>
              <Button
                onClick={async () => {
                  setLoadedFiles(0);
                  setTotalFiles(0);

                  const onProgress = (deltaLoaded: number, deltaTotal: number) => {
                    loadedFilesRef.current += deltaLoaded;
                    totalFilesRef.current += deltaTotal;
                    setLoadedFiles(loadedFilesRef.current);
                    setTotalFiles(totalFilesRef.current);
                  };

                  const result = await openDirectory("read", {
                    onFileDiscovered: () => {
                      onProgress(0, 1);
                    },
                    onFileLoaded: () => {
                      onProgress(1, 0);
                    },
                  });
                  if (!result) {
                    return;
                  }
                  const { folderName, fileMap } = result;
                  const collection = await Collection.loadCollectionFromFile(folderName, fileMap);
                  collection.tryLoadDataset(collection.getDefaultDatasetKey()).then((result) => {
                    if (result.loaded) {
                      props.onLoad(collection, collection.getDefaultDatasetKey(), result.dataset);
                    }
                  });
                }}
              >
                Load directory
              </Button>
              Files loaded: {loadedFiles}/{totalFiles}
            </FlexRowAlignCenter>
          </div>

          {errorText && (
            <p>
              <span style={{ color: theme.color.text.error }}>{errorText}</span>
            </p>
          )}
        </div>
      </StyledModal>
    </div>
  );
}
