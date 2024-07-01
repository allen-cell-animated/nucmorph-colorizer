export type DisposableValue = {
  dispose?: () => void;
};

type CacheEntry<E extends DisposableValue> = {
  key: string;
  value: E;
  size: number;
  prev: CacheEntry<E> | null;
  next: CacheEntry<E> | null;
};

/**
 * Generic LRU cache for data, intended for Texture or other GPU resources.
 * Calls `dispose` on eviction to keep GPU memory under control.
 *
 * Keys can be "reserved" which protects them from eviction and disposal. See
 * `setReservedKeys` for more information.
 *
 * @template E The type of the data to be stored in the cache.
 * @param maxSize The maximum size of the cache. This can either be the number of entries
 * or the total size of the entries (e.g. bytes)
 */
export default class DataCache<E extends DisposableValue> {
  private data: Map<string, CacheEntry<E>>;
  // Next points towards front of the list (most recently used), prev points towards back
  private first: CacheEntry<E> | null;
  private last: CacheEntry<E> | null;
  private currentSize: number;
  private maxSize: number;
  /**
   * A set of keys that are exempted from eviction and disposal.
   * Entries with keys in this set should not be reachable via normal linked-list
   * traversal (e.g., they are not reachable from `this.first` or `this.last`).
   */
  private reservedKeys: Set<string>;

  constructor(maxSize: number = 30) {
    this.data = new Map();
    this.first = null;
    this.last = null;
    this.currentSize = 0;
    this.maxSize = maxSize;
    this.reservedKeys = new Set();
  }

  /** Evicts the least recently used entry from the cache */
  private evictLast(): void {
    if (!this.last) {
      return;
    }

    if (this.last.next) {
      this.last.next.prev = null;
    }

    if (this.last.value.dispose) {
      this.last.value.dispose();
    }
    this.data.delete(this.last.key);
    this.currentSize -= this.last.size;
    this.last = this.last.next;
  }

  /** Places an entry at the front of the list */
  private setNewEntryAsFirst(entry: CacheEntry<E>): void {
    if (this.first) {
      this.first.next = entry;
    }
    entry.prev = this.first;
    entry.next = null;
    this.first = entry;
  }

  /** Moves an EXISTING entry currently in the list to the front */
  private moveToFirst(entry: CacheEntry<E>): void {
    if (entry === this.first) return;
    const { prev, next } = entry;

    if (prev) {
      prev.next = next;
    } else {
      this.last = next;
    }

    if (next) {
      next.prev = prev;
    }

    entry.next = null;
    this.setNewEntryAsFirst(entry);
  }

  /** Removes an entry from the linked list without disposing of it. */
  private removeFromList(entry: CacheEntry<E>): void {
    if (entry === this.first) {
      this.first = entry.prev;
    }
    if (entry === this.last) {
      this.last = entry.next;
    }
    if (entry.prev) {
      entry.prev.next = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    }
  }

  /**
   * Sets the currently reserved keys, preventing them from being evicted from the cache
   * and disposed of.
   * @param keys the set of keys that should be reserved.
   * If a key is currently reserved but is not in the new set, it will be "unreserved" and
   * subject to normal cache eviction.
   * Reserved keys/values will still count towards the total size limit for the cache
   */
  public setReservedKeys(keys: Set<string>): void {
    // Check for newly reserved keys; remove from cache list if they are currently saved.
    keys.forEach((key) => {
      if (!this.reservedKeys.has(key)) {
        const entry = this.data.get(key);
        entry && this.removeFromList(entry);
      }
    });
    // Check for newly unreserved keys; add back to cache list as they are now eligible
    // for eviction/disposal.
    this.reservedKeys.forEach((key) => {
      if (!keys.has(key)) {
        const entry = this.data.get(key);
        entry && this.setNewEntryAsFirst(entry);
      }
    });

    this.reservedKeys = new Set(keys);
  }

  public get size(): number {
    return this.currentSize;
  }

  /**
   * Inserts a value into the cache with the key. If the key already exists, the value is replaced.
   * If the cache is full, the least recently used entry is evicted and its `dispose()` function is
   * called if it exists.
   *
   * Throws an error if the `size` is greater than the cache's `maxSize`, as defined in the
   * constructor.
   */
  public insert(key: string | number, value: E, size: number = 1): void {
    key = key.toString();
    const currentEntry = this.data.get(key);

    if (size > this.maxSize) {
      throw new Error(`Attempted to insert a value of size ${size} into a cache with maxSize ${this.maxSize}`);
    }

    if (currentEntry !== null && currentEntry !== undefined) {
      // NOTE: This assumes that the value's size HAS NOT CHANGED. If it has,
      // the size of the cache will be incorrect and the old value will not be disposed of.
      // TODO: Throw an error if the size is different?
      currentEntry.value = value;
      if (!this.reservedKeys.has(key)) {
        this.moveToFirst(currentEntry);
      }
    } else {
      const newEntry = { value, key, prev: null, next: null, size: size };
      this.data.set(key, newEntry);

      this.currentSize += size;
      while (this.currentSize > this.maxSize && this.last) {
        this.evictLast();
      }

      if (!this.reservedKeys.has(key)) {
        this.setNewEntryAsFirst(newEntry);
        if (!this.last) {
          this.last = newEntry;
        }
      }
    }
  }

  /** Retrieves a value from the cache. Returns `undefined` if the `key` could not be found. */
  public get(key: string | number): E | undefined {
    key = key.toString();
    const entry = this.data.get(key);
    if (entry && !this.reservedKeys.has(key)) {
      this.moveToFirst(entry);
    }
    return entry?.value;
  }

  /** Clears the cache and calls `dispose()` on all entries to clear their resources,
   * including reserved keys. */
  public dispose(): void {
    this.first = null;
    this.last = null;
    this.currentSize = 0;
    this.data.forEach((cacheEntry) => {
      cacheEntry.value.dispose && cacheEntry.value.dispose();
    });
    this.data.clear();
  }
}
