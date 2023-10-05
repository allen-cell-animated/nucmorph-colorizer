import { Tooltip } from "antd";
import { TooltipPlacement } from "antd/es/tooltip";
import React, { PropsWithChildren, ReactElement, cloneElement, forwardRef, useEffect, useRef, useState } from "react";

type AccessibleTooltipProps = {
  disabled?: boolean;
  title?: string;
  placement?: TooltipPlacement;
};

/**
 * Layout-safe, focus-responsive tooltip! This is a wrapper around the Ant Tooltip,
 * fixing some of the biggest issues with it:
 * - Does not change layouts when disabled
 * - Responds to focus events, so it can be used with tab navigation
 *
 * Note: Ant sometimes passes information in props between components, such as for the
 * Dropdown and its children. This component will not work in those cases.
 */
const AccessibleTooltip = forwardRef(function (props: PropsWithChildren<AccessibleTooltipProps>, ref): ReactElement {
  const [forceOpen, setForceOpen] = useState(false);
  const componentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    componentRef.current?.addEventListener("focusin", () => setForceOpen(true));
    componentRef.current?.addEventListener("focusout", () => setForceOpen(false));
  }, []);

  // Add ref to child for focus listening without breaking existing refs
  const child = props.children as ReactElement;
  const childWithRef = cloneElement(child, {
    ref: (el: HTMLElement) => {
      componentRef.current = el;
      // Call the original ref, if any
      const { ref } = child.props;
      if (typeof ref === "function") {
        ref(el);
      }
    },
  });

  if (props.disabled && !forceOpen) {
    return <>{childWithRef}</>;
  }

  return (
    <Tooltip title={props.title} placement={props.placement} open={forceOpen ? true : undefined}>
      {childWithRef}
    </Tooltip>
  );
});

export default AccessibleTooltip;
