import React, { ReactElement, useMemo } from "react";
import styles from "./ColorRampSelector.module.css";
import { ColorRamp } from "../colorizer";
import { DEFAULT_COLOR_RAMP, DEFAULT_COLOR_RAMPS } from "../constants";
import { Button, Tooltip } from "antd";

type ColorRampSelectorProps = {
  selected: string;
  colorRamps?: Map<string, ColorRamp>;
  disabled?: boolean;
  onChange: (value: string) => void;
};

const defaultProps: Partial<ColorRampSelectorProps> = {
  colorRamps: DEFAULT_COLOR_RAMPS,
  disabled: false,
};
const ColorRampSelector: React.FC<ColorRampSelectorProps> = (props): ReactElement => {
  props = { ...defaultProps, ...props };

  const selectedRamp = props.colorRamps?.get(props.selected);
  if (!selectedRamp) {
    throw new Error("No ColorRamp is selected.");
  }

  const selectedRampColorUrl = useMemo(() => {
    return selectedRamp.createGradientCanvas(120, 25).toDataURL();
  }, [props.selected]);

  // Memoize to avoid recalculating dropdown contents
  const dropdownContents: ReactElement[] = useMemo(() => {
    const contents: ReactElement[] = [];
    const colorRampEntries = Array.from(props.colorRamps!.entries());
    // Make a button for every color ramp
    for (let i = 0; i < props.colorRamps!.size; i++) {
      let className = "";
      // Manipulate class names for rounding at start and end of dropdown list
      if (i === 0) {
        className += " " + styles.dropdownFirst;
      }
      if (i === props.colorRamps!.size) {
        className += " " + styles.dropdownLast;
      }
      const [name, colorRamp] = colorRampEntries[i];
      contents.push(
        <Tooltip title={name} placement="right" key={name}>
          <Button key={name} className={className} onClick={() => props.onChange(name)}>
            <img src={colorRamp.createGradientCanvas(120, 25).toDataURL()} />
          </Button>
        </Tooltip>
      );
    }
    return contents;
  }, [props.colorRamps]);

  // Force tooltip to be hidden (false) when the disabled flag is true.
  // Otherwise, don't override the default behavior.
  const showTooltip = props.disabled ? false : undefined;
  const buttonDivClassName = styles.buttonContainer + " " + props.disabled ? styles.buttonContainer : "";

  return (
    <div className={styles.colorRampSelector}>
      Color Ramp
      <div className={buttonDivClassName}>
        <Tooltip title={props.selected} placement="right" open={showTooltip}>
          <Button rootClassName={styles.selectorButton} disabled={props.disabled}>
            <img src={selectedRampColorUrl} />
          </Button>
        </Tooltip>

        <div className={styles.dropdownContainer}>{dropdownContents}</div>
      </div>
    </div>
  );
};
export default ColorRampSelector;
