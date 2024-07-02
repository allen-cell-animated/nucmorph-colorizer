import { describe, expect, it } from "vitest";

import DataCache from "../src/colorizer/DataCache";

describe("DataCache", () => {
  class DisposableString {
    public value: string;
    public hasBeenDisposed: boolean = false;

    constructor(value: string) {
      this.value = value;
    }

    dispose(): void {
      this.hasBeenDisposed = true;
    }
  }

  it("can insert and retrieve values up to capacity", () => {
    const cache = new DataCache<DisposableString>(3);

    cache.insert("1", new DisposableString("A"));
    expect(cache.size).toBe(1);
    cache.insert("2", new DisposableString("B"));
    expect(cache.size).toBe(2);
    cache.insert("3", new DisposableString("C"));
    expect(cache.size).toBe(3);
  });

  it("returns undefined for values not in cache", () => {
    const cache = new DataCache<DisposableString>(3);

    cache.insert("1", new DisposableString("A"));

    expect(cache.get("2")?.value).toBe(undefined);
    expect(cache.get("3")?.value).toBe(undefined);
    expect(cache.get("A")?.value).toBe(undefined);
  });

  it("accepts both integers and strings as keys", () => {
    const cache = new DataCache<DisposableString>(3);

    cache.insert("1", new DisposableString("A"));
    cache.insert(2, new DisposableString("B"));
    cache.insert("3", new DisposableString("C"));

    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get(1)?.value).toBe("A");
    expect(cache.get("2")?.value).toBe("B");
    expect(cache.get(2)?.value).toBe("B");
    expect(cache.get("3")?.value).toBe("C");
    expect(cache.get(3)?.value).toBe("C");
  });

  it("evicts entries when new items are inserted", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    cache.insert("3", new DisposableString("C"));
    expect(cache.size).toBe(3);

    // Inserting another value will evict the oldest value, 1
    cache.insert("4", new DisposableString("D"));
    expect(cache.size).toBe(3);

    expect(cache.get("1")?.value).toBe(undefined);
    expect(cache.get("2")?.value).toBe("B");
    expect(cache.get("3")?.value).toBe("C");
    expect(cache.get("4")?.value).toBe("D");
  });

  it("calls dispose() on entries when they are evicted", () => {
    const cache = new DataCache<DisposableString>(1);
    const a = new DisposableString("A");
    const b = new DisposableString("B");

    cache.insert("1", a);
    expect(a.hasBeenDisposed).toBe(false);

    // Key 1 is evicted, so `a` should be disposed.
    cache.insert("2", b);
    expect(a.hasBeenDisposed).toBe(true);
    expect(b.hasBeenDisposed).toBe(false);
  });

  it("moves values to front of list when they are accessed (evicts LRU)", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    cache.insert("3", new DisposableString("C"));

    // 1 is oldest, but accessing it will make it the newest.
    // 2 is now the oldest and will be evicted next time a new value is inserted.
    cache.get("1");

    cache.insert("4", new DisposableString("D"));
    expect(cache.size).toBe(3);
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe(undefined);
    expect(cache.get("3")?.value).toBe("C");
    expect(cache.get("4")?.value).toBe("D");
  });

  it("replaces values when reinserted", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"));
    expect(cache.get("1")?.value).toBe("A");

    cache.insert("1", new DisposableString("AA"));
    expect(cache.get("1")?.value).toBe("AA");
  });

  it("accounts for entry size when evicting to maintain max size", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"), 1);
    expect(cache.size).toBe(1);
    cache.insert("2", new DisposableString("B"), 2);
    expect(cache.size).toBe(3);

    // Insert a third value that has a size of 2. Key 1 is the oldest value,
    // but because key 2 also has a size of 2, both must be
    // evicted to make room for the new value.
    cache.insert("3", new DisposableString("C"), 2);
    expect(cache.size).toBe(2);
    expect(cache.get("1")?.value).toBe(undefined);
    expect(cache.get("2")?.value).toBe(undefined);
    expect(cache.get("3")?.value).toBe("C");
  });

  it("allows entry sizes larger than capacity", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"), 4);
    expect(cache.size).toBe(4);
    expect(cache.get("1")?.value).toBe("A");

    // Inserting another large value should evict the first value.
    cache.insert("2", new DisposableString("B"), 18);
    expect(cache.size).toBe(18);
    expect(cache.get("1")?.value).toBe(undefined);
    expect(cache.get("2")?.value).toBe("B");
  });

  it("allows values that are non-disposable", () => {
    const cache = new DataCache<string[]>(2);
    cache.insert("1", ["A"]);
    cache.insert("2", ["B"]);
    expect(cache.size).toBe(2);

    expect(cache.get("1")).toEqual(["A"]);
    expect(cache.get("2")).toEqual(["B"]);

    // Insert a value and evict the oldest value.
    cache.insert("3", ["C"]);
    expect(cache.size).toBe(2);
    expect(cache.get("1")).toBe(undefined);
    expect(cache.get("2")).toEqual(["B"]);
    expect(cache.get("3")).toEqual(["C"]);
  });

  it("reserves keys and prevents them from being evicted", () => {
    const cache = new DataCache<DisposableString>(3);
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    cache.insert("3", new DisposableString("C"));
    cache.setReservedKeys(new Set(["1", "2"]));
    expect(cache.size).toBe(3);

    // Add another element, 4, to the cache, which will force an element to be
    // evicted. 1 and 2 are oldest elements, but because they are reserved,
    // element 3 is the oldest non-reserved element and will be evicted.
    cache.insert("4", new DisposableString("D"));
    expect(cache.size).toBe(3);
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe("B");
    expect(cache.get("3")?.value).toBe(undefined);
    expect(cache.get("4")?.value).toBe("D");
  });

  it("allows unreserved keys to be evicted", () => {
    const cache = new DataCache<DisposableString>(2);
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    cache.setReservedKeys(new Set(["1"]));
    expect(cache.size).toBe(2);

    // 1 is reserved, so 2 will be evicted when a new value is inserted.
    cache.insert("3", new DisposableString("C"));
    expect(cache.size).toBe(2);
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe(undefined);
    expect(cache.get("3")?.value).toBe("C");

    // Remove 1 from the reserved keys. It will be added to the front of the list.
    cache.setReservedKeys(new Set([]));

    // Test that 1 is at the front of the list (3 should be the oldest
    // and evicted next time a new value is inserted).
    cache.insert("4", new DisposableString("D"));
    expect(cache.size).toBe(2);
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("4")?.value).toBe("D");

    // Inserting one more value will evict 1
    cache.insert("5", new DisposableString("E"));
    expect(cache.size).toBe(2);
    expect(cache.get("4")?.value).toBe("D");
    expect(cache.get("5")?.value).toBe("E");
  });

  it("reserves keys even if they are added to the cache later", () => {
    const cache = new DataCache<DisposableString>(2);
    cache.setReservedKeys(new Set(["1"]));
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    cache.insert("3", new DisposableString("C"));
    expect(cache.size).toBe(2);

    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe(undefined);
    expect(cache.get("3")?.value).toBe("C");
  });

  it("keeps newly added value even if it + reserved keys would exceed max size", () => {
    const cache = new DataCache<DisposableString>(2);
    cache.setReservedKeys(new Set(["1", "2"]));
    cache.insert("1", new DisposableString("A"));
    cache.insert("2", new DisposableString("B"));
    expect(cache.size).toBe(2);

    // Inserting a third value exceeds the max, but because it is new
    // it should not be immediately evicted.
    cache.insert("3", new DisposableString("C"));
    expect(cache.size).toBe(3);
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe("B");
    expect(cache.get("3")?.value).toBe("C");

    // Inserting another value should evict 3.
    cache.insert("4", new DisposableString("D"));
    expect(cache.get("1")?.value).toBe("A");
    expect(cache.get("2")?.value).toBe("B");
    expect(cache.size).toBe(3);
    expect(cache.get("3")?.value).toBe(undefined);
    expect(cache.get("4")?.value).toBe("D");
  });
});
