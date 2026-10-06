/**
 * Per-host politeness gate: requests to one host run strictly one at a time, and each starts at
 * least `gapMs` (the robots.txt Crawl-delay, or the default) after the previous one finished.
 * Different hosts run independently. Once the crawl's signal is aborted, waiting and new requests
 * fail with `GateStopped` instead of firing back-to-back.
 *
 * Never call `run` for a host from inside a task already running for that host: the inner task
 * waits for the outer one, which waits for it (a deadlock).
 */

export const DEFAULT_GAP_MS = 750;

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Thrown by `HostGate.run` when the crawl was stopped before the request's turn came. */
export class GateStopped extends Error {
  readonly code = "STOPPED";
  constructor() {
    super("Crawl stopped.");
  }
}

export class HostGate {
  private tail = new Map<string, Promise<unknown>>();
  private last = new Map<string, number>();
  private gaps = new Map<string, number>();
  constructor(
    private readonly defaultGap = DEFAULT_GAP_MS,
    private readonly signal?: AbortSignal,
    private readonly now: () => number = Date.now,
  ) {}

  setGap(host: string, ms: number) {
    this.gaps.set(host, Math.max(this.defaultGap, ms));
  }
  gapOf(host: string) {
    return this.gaps.get(host) ?? this.defaultGap;
  }

  run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tail.get(host) ?? Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(async () => {
        const last = this.last.get(host);
        if (last != null) await sleep(last + this.gapOf(host) - this.now(), this.signal);
        // sleep() returns early on abort: skip the request rather than ignore the Crawl-delay.
        if (this.signal?.aborted) throw new GateStopped();
        try {
          return await fn();
        } finally {
          this.last.set(host, this.now());
        }
      });
    this.tail.set(host, task);
    return task;
  }
}

/** Concurrency limiter: `limit(fn)` runs fn when fewer than `n` limited tasks are in flight. */
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A finishing task hands its slot straight to the next waiter, so at most n ever run.
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
