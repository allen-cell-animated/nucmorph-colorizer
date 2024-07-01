import { SearchOutlined } from "@ant-design/icons";
import { ButtonProps, Input, InputRef, Tooltip } from "antd";
import { ItemType, MenuItemType } from "antd/es/menu/hooks/useItems";
import Fuse from "fuse.js";
import React, { MutableRefObject, ReactElement, useMemo, useRef, useState, useTransition } from "react";

import { FlexColumn } from "../../styles/utils";

import LoadingSpinner from "../LoadingSpinner";
import AccessibleDropdown from "./AccessibleDropdown";
import DropdownItem from "./DropdownItem";
import DropdownItemList from "./DropdownItemList";

// TODO: Have the dropdown show a loading indicator after a selection has been made
// but before the prop value updates. -> this is especially noticeable when slow datasets.
// Is there a way we can do this using async promises, maybe? If the promise rejects,
// discard the changed value?

type SelectionDropdownProps = {
  /** Text label to include with the dropdown. If null or undefined, hides the label. */
  label?: string | null;
  /** The key of the item that is currently selected. */
  selected: string | undefined;
  /** An array of ItemType that describes the item properties (`{key, label}`),
   * or an array of strings. Dropdown items will be presented in the provided array order.
   *
   * If a string array is provided, ItemType objects will be
   * auto-generated with `key` and `label` values set to the string.*/
  items: ItemType[] | string[];
  disabled?: boolean;
  /** The type of button to render for the dropdown. See Antd's button types:
   * https://ant.design/components/button#components-button-demo-basic */
  buttonType?: ButtonProps["type"] | "outlined";
  /** Callback that is fired whenever an item in the dropdown is selected.
   * The callback will be passed the `key` of the selected item. */
  onChange: (key: string) => void;
  showTooltip?: boolean;
  /** Width of the dropdown. Overrides the default sizing behavior if set. */
  width?: string | null;
  /**
   * Whether the search bar should be enabled. If enabled, will show search bar and filter
   * by search input when the total number of items is above `searchThresholdCount`. True by default.
   */
  enableSearch?: boolean;
  /** The number of items that must be in the original list before the search bar will be shown. 10 by default.*/
  searchThresholdCount?: number;
};

const defaultProps: Partial<SelectionDropdownProps> = {
  label: null,
  disabled: false,
  buttonType: "outlined",
  showTooltip: true,
  width: null,
  enableSearch: true,
  searchThresholdCount: 10,
};

/**
 * An wrapper around an AccessibleDropdown that allows for the selection of a single item from a list.
 *
 * Items can be passed in as an array of strings, or as an array of ItemType objects if you need the
 * keys to differ from the labels.
 */
export default function SelectionDropdown(inputProps: SelectionDropdownProps): ReactElement {
  const props = { ...defaultProps, ...inputProps } as Required<SelectionDropdownProps>;

  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState("");
  const [filteredItems, setFilteredItems] = useState<MenuItemType[]>([]);
  const searchInputRef = useRef<InputRef>();

  // Convert items into MenuItemType, adding missing properties as needed
  const items = useMemo((): MenuItemType[] => {
    if (props.items.length === 0) {
      return [];
    }
    if (typeof props.items[0] === "string") {
      // string array instead of ItemType array
      return (props.items as string[]).map((name) => {
        return {
          label: name,
          key: name,
        };
      });
    } else {
      return props.items as MenuItemType[];
    }
  }, [props.items]);

  // Get the label of the selected item to display in the dropdown button
  const selectedLabel = useMemo((): string => {
    for (const item of items) {
      if (item && item.key === props.selected) {
        return item.label?.toString() || "";
      }
    }
    return "";
  }, [props.selected, items]);

  // Set up fuse for fuzzy searching
  const fuse = useMemo(() => {
    return new Fuse(items, {
      keys: ["key", "label"],
      isCaseSensitive: false,
      shouldSort: true, // sorts by match score
    });
  }, [props.items]);

  // Filter the items based on the search input
  useMemo(() => {
    if (searchInput === "") {
      startTransition(() => {
        // Reset to original list
        setFilteredItems(items);
      });
    } else {
      const searchResult = fuse.search(searchInput);
      const filteredItems = searchResult.map((result) => result.item);
      startTransition(() => {
        setFilteredItems(filteredItems);
      });
    }
  }, [searchInput, items]);

  // Completely customize the dropdown menu and make the buttons manually.
  // This is because Antd's Dropdown component doesn't allow us to add item tooltips, and complicates
  // other behaviors (like tab navigation or setting width).
  // Ant recommends using the Popover component for this instead of Dropdown, but they use
  // different animation styling (Dropdown looks nicer).

  const getDropdownItems = (closeDropdown: () => void): ReactElement[] => {
    return filteredItems.map((item) => {
      return (
        <Tooltip key={item.key} title={item.label?.toString()} placement="right" trigger={["hover", "focus"]}>
          <DropdownItem
            key={item.key}
            selected={item.key === props.selected}
            disabled={props.disabled}
            onClick={() => {
              props.onChange(item.key.toString());
              closeDropdown();
              // Add a slight delay so the dropdown closes first before the input is cleared
              setTimeout(() => setSearchInput(""), 1);
            }}
          >
            {item.label}
          </DropdownItem>
        </Tooltip>
      );
    });
  };

  const showSearch = props.enableSearch && items.length > props.searchThresholdCount;
  const getDropdownContent = (setForceOpen: (forceOpen: boolean) => void): ReactElement => {
    const closeDropdown = (): void => {
      setForceOpen(false);
    };
    if (showSearch) {
      return (
        <FlexColumn $gap={6}>
          <Input
            style={{ paddingLeft: "6px" }}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
            }}
            prefix={<SearchOutlined style={{ color: "var(--color-text-hint)" }} />}
            placeholder="Type to search"
            allowClear
            ref={searchInputRef as MutableRefObject<InputRef>}
            onFocus={() => {
              // Keep the dropdown pinned open if the user clicks into the input box
              setForceOpen(true);
            }}
            spellCheck={false}
          ></Input>
          <LoadingSpinner loading={isPending} style={{ borderRadius: "4px", overflow: "hidden" }}>
            <DropdownItemList>{getDropdownItems(closeDropdown)}</DropdownItemList>
          </LoadingSpinner>
        </FlexColumn>
      );
    } else {
      return <DropdownItemList>{getDropdownItems(closeDropdown)}</DropdownItemList>;
    }
  };

  const mainButtonStyle: React.CSSProperties = {
    width: props.width || "15vw",
    minWidth: "60px",
    maxWidth: "270px",
  };

  return (
    <AccessibleDropdown
      label={props.label}
      disabled={props.disabled}
      buttonStyle={mainButtonStyle}
      buttonType={props.buttonType}
      buttonText={selectedLabel}
      showTooltip={props.showTooltip}
      dropdownContent={getDropdownContent}
      onButtonClicked={() => {
        // Focus the search input when the dropdown is clicked open
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }}
    ></AccessibleDropdown>
  );
}
