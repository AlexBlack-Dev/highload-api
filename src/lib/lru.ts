interface LruEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Minimal TTL LRU cache used for hot-path lookups (api key metadata,
 * mirror responses). Not thread-safe, but Node is single-threaded per
 * event loop tick, and the entry point awaits between mutations.
 */
export class TtlLru<K, V> {
  private readonly map = new Map<K, LruEntry<V>>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {
    if (maxSize < 1) throw new Error("maxSize must be >= 1");
    if (ttlMs < 0) throw new Error("ttlMs must be >= 0");
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const ttl = this.ttlMs;
    const expiresAt = ttl === 0 ? Number.POSITIVE_INFINITY : Date.now() + ttl;
    const existing = this.map.get(key);
    if (existing) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}