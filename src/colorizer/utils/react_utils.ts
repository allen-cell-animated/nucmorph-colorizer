import { EventHandler, useEffect, useRef, useState } from "react";

/**
 * Delays changes to a value until no changes have occurred for the
 * set delay period, in milliseconds. This is useful for delaying changes to state
 * when a value may update very quickly.
 *
 * Adapted from https://usehooks-ts.com/react-hook/use-debounce.
 *
 * @param value The value to return.
 * @param delayMs The delay, in milliseconds.
 * @returns The `value` once no changes have occurred for `delay` milliseconds.
 * @example
 * ```
 * const [value, setValue] = useState(0);
 * const debouncedValue = useDebounce(value, 500);
 *
 * useEffect(() => {
 *  // Some expensive operation
 * }, [debouncedValue])
 *
 * return(
 *  <div>
 *      <p>{debouncedValue}</p>
 *  </div>
 * )
 * ```
 */
export function useDebounce<T>(value: T, delayMs?: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs || 500);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}

/**
 * Returns a reference to a constructed value that will not be re-computed between renders.
 *
 * Functionally, this is a wrapper around useRef and allows it to be used in a type-safe way.
 * See https://react.dev/reference/react/useRef for more details.
 *
 * @param constructor A callback used to assign the value. This will only be called once.
 * @returns The value as returned by the constructor.
 * @example
 * ```
 * const value = useConstructor(() => {return new ValueConstructor()});
 * ```
 */
export function useConstructor<T>(constructor: () => T): T {
  const value = useRef<T | null>(null);
  if (value.current === null) {
    value.current = constructor();
  }
  return value.current;
}

/** Returns a shallow copy of an object, excluding all entries where the value is undefined. */
export function excludeUndefinedValues<T extends Object>(obj: T): Partial<T> {
  const ret = {} as Partial<T>;
  for (const key in obj) {
    if (obj[key] !== undefined) {
      ret[key] = obj[key];
    }
  }
  return ret;
}

export function useScrollWithShadow(
  cssColor: string = "rgb(200 200 200 / 1)"
): [React.CSSProperties, EventHandler<any>] {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollHeight, setScrollHeight] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);

  const onScrollHandler: EventHandler<any> = (event) => {
    console.log("Updating scroll values");
    setScrollTop(event.target.scrollTop);
    setScrollHeight(event.target.scrollHeight);
    setClientHeight(event.target.clientHeight);
  };

  function getBoxShadow() {
    const isBottom = clientHeight === scrollHeight - scrollTop;
    const isTop = scrollTop === 0;
    const isBetween = scrollTop > 0 && clientHeight < scrollHeight - scrollTop;

    let boxShadow = "none";
    const top = `inset 0 8px 5px -5px ${cssColor}`;
    const bottom = `inset 0 -8px 5px -5px ${cssColor}`;

    if (isTop) {
      boxShadow = bottom;
    } else if (isBetween) {
      boxShadow = `${top}, ${bottom}`;
    } else if (isBottom) {
      boxShadow = top;
    }
    return boxShadow;
  }

  return [{ boxShadow: getBoxShadow() }, onScrollHandler];
}
