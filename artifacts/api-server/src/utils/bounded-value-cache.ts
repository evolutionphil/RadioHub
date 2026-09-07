/** A byte-budgeted hot tier for payloads too large for the small-entry cache.
 * Bytes are a serialized UTF-16 estimate, not a claim about V8 heap usage.
 * Entry, per-value and aggregate caps bound retention independently.
 */
export class BoundedValueCache {
  private readonly entries = new Map<string, { value: unknown; bytes: number; expiresAt: number }>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly maxValueBytes = 8 * 1024 * 1024,
    private readonly maxEntries = 32,
    private readonly now = Date.now,
  ) {}

  delete(key: string): void {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.delete(key);
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) { this.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown, bytes: number, ttlSeconds: number): boolean {
    // Even a rejected replacement must invalidate the previous value.
    this.delete(key);
    this.prune();
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.maxValueBytes || bytes > this.maxBytes ||
        !Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || this.maxEntries <= 0) return false;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, bytes, expiresAt: this.now() + ttlSeconds * 1000 });
    this.bytes += bytes;
    return true;
  }

  getTtl(key: string): number | undefined {
    this.prune();
    return this.entries.get(key)?.expiresAt;
  }

  clearByPattern(pattern: string): void {
    for (const key of this.entries.keys()) if (key.includes(pattern)) this.delete(key);
  }

  stats() {
    this.prune();
    return { keys: this.entries.size, estimatedBytes: this.bytes, maxBytes: this.maxBytes };
  }
}
