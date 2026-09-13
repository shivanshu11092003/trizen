import { HttpError } from './errors.js';

/** Unordered worker pool. For uploads/downloads where completion order is irrelevant. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  opts: { signal?: AbortSignal; onSettled?: (done: number, total: number) => void } = {},
): Promise<PromiseSettledResult<R>[]> {
  // Create signals inside the operation: Workers disallow this at module scope.
  const signal = opts.signal ?? new AbortController().signal;
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!, i, signal) };
      } catch (reason) {
        // One bad file must not fail the batch. The caller decides what a
        // partial success means -- for 40 photos, 39 succeeded.
        results[i] = { status: 'rejected', reason };
      }
      opts.onSettled?.(++done, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Ordered bounded prefetch. Keeps `window` operations in flight but yields
 * strictly in input order -- exactly what a ZIP stream needs: entries must be
 * written in order, but fetching one at a time wastes the round-trip budget.
 */
export async function* prefetch<T, R>(
  items: Iterable<T>,
  window: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const it = items[Symbol.iterator]();
  // Settle eagerly: an in-flight rejection must not surface as an unhandled
  // rejection while we are awaiting an earlier entry.
  const queue: Promise<{ ok: true; v: R } | { ok: false; e: unknown }>[] = [];

  const pump = (): boolean => {
    const n = it.next();
    if (n.done) return false;
    queue.push(
      fn(n.value).then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e }),
      ),
    );
    return true;
  };

  while (queue.length < Math.max(1, window) && pump());
  while (queue.length) {
    const r = await queue.shift()!;
    pump();
    if (!r.ok) throw r.e;
    yield r.v;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export const defaultRetryable = (e: unknown): boolean =>
  e instanceof HttpError ? e.status === 408 || e.status === 429 || e.status >= 500 : e instanceof TypeError;

/**
 * Retry with full jitter. Jitter, not fixed backoff -- 40 files retrying in
 * lockstep is a self-inflicted thundering herd.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts?: number;
    baseMs?: number;
    capMs?: number;
    signal?: AbortSignal;
    isRetryable?: (e: unknown) => boolean;
    random?: () => number;
  } = {},
): Promise<T> {
  const {
    attempts = 4,
    baseMs = 300,
    capMs = 8_000,
    signal,
    isRetryable = defaultRetryable,
    random = Math.random,
  } = opts;
  const operationSignal = signal ?? new AbortController().signal;

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(operationSignal);
    } catch (e) {
      if (attempt >= attempts - 1 || !isRetryable(e)) throw e;
      await sleep(random() * Math.min(capMs, baseMs * 2 ** attempt), signal);
    }
  }
}
