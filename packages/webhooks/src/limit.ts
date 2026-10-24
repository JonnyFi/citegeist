/**
 * Counts failed logins per source inside a sliding window. Once a source has used up its
 * failures, it is turned away (429) until the oldest failure leaves the window. A second, larger
 * budget over all sources stops guessing from many addresses.
 */
export class FailureLimiter {
  private readonly bySource = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly perSource = 10,
    private readonly overall = 100,
    private readonly windowMs = 60_000,
  ) {}

  private prune(times: number[], now: number): number[] {
    const from = now - this.windowMs;
    let i = 0;
    while (i < times.length && (times[i] ?? 0) <= from) i += 1;
    return i === 0 ? times : times.slice(i);
  }

  /** Seconds the source has to wait, or 0 when it may try. */
  retryAfter(source: string, now: number): number {
    this.all = this.prune(this.all, now);
    const mine = this.prune(this.bySource.get(source) ?? [], now);
    if (mine.length > 0) this.bySource.set(source, mine);
    else this.bySource.delete(source);
    const waits: number[] = [];
    // The failure whose leaving brings the count back under the limit.
    const mineKey = mine[mine.length - this.perSource];
    if (mine.length >= this.perSource && mineKey !== undefined) waits.push(mineKey);
    const allKey = this.all[this.all.length - this.overall];
    if (this.all.length >= this.overall && allKey !== undefined) waits.push(allKey);
    if (waits.length === 0) return 0;
    return Math.max(1, Math.ceil((Math.max(...waits) + this.windowMs - now) / 1000));
  }

  fail(source: string, now: number): void {
    const mine = this.prune(this.bySource.get(source) ?? [], now);
    mine.push(now);
    this.bySource.set(source, mine);
    this.all.push(now);
    if (this.bySource.size > 5000) {
      const oldest = this.bySource.keys().next().value;
      if (oldest !== undefined) this.bySource.delete(oldest);
    }
  }
}
