/** A tiny time-to-live cache. Also shares one in-flight request between identical callers. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { expires: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = load();
    this.entries.set(key, { expires: this.now() + this.ttlMs, value });
    try {
      return await value;
    } catch (err) {
      // Failures are not cached, so a fixed key works on the next ask.
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
