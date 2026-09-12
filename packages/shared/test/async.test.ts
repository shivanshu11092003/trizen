import { describe, expect, it, vi } from 'vitest';
import { HttpError, mapPool, prefetch, withRetry } from '../src/index.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await tick(1);
      inFlight--;
    });
    expect(peak).toBe(4);
  });

  it('reports partial success instead of failing the batch', async () => {
    const results = await mapPool([1, 2, 3, 4], 2, async (n) => {
      if (n === 3) throw new Error('bad file');
      return n * 2;
    });
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('preserves input order in the results array', async () => {
    const results = await mapPool([30, 1, 20, 2], 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([30, 1, 20, 2]);
  });

  it('stops scheduling work once aborted', async () => {
    const ac = new AbortController();
    const seen: number[] = [];
    const p = mapPool(Array.from({ length: 20 }, (_, i) => i), 2, async (n) => {
      seen.push(n);
      await tick(2);
      if (n === 3) ac.abort();
    }, { signal: ac.signal });
    await p;
    expect(seen.length).toBeLessThan(20);
  });

  it('reports progress once per settled item', async () => {
    const onSettled = vi.fn();
    await mapPool([1, 2, 3], 2, async (n) => n, { onSettled });
    expect(onSettled).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenLastCalledWith(3, 3);
  });
});

describe('prefetch', () => {
  it('yields in input order regardless of completion order', async () => {
    const out: number[] = [];
    for await (const v of prefetch([40, 5, 30, 1, 20], 3, async (ms) => {
      await tick(ms);
      return ms;
    })) {
      out.push(v);
    }
    expect(out).toEqual([40, 5, 30, 1, 20]);
  });

  it('keeps exactly `window` operations in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const gen = prefetch(Array.from({ length: 12 }, (_, i) => i), 3, async (i) => {
      peak = Math.max(peak, ++inFlight);
      await tick(2);
      inFlight--;
      return i;
    });
    for await (const _ of gen) void _;
    expect(peak).toBe(3);
  });

  it('propagates a rejection at its turn, not as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const v of prefetch([1, 2, 3, 4], 3, async (n) => {
          if (n === 2) throw new Error('boom');
          await tick(5);
          return n;
        })) {
          seen.push(v);
        }
      })(),
    ).rejects.toThrow('boom');
    await tick(20);
    process.off('unhandledRejection', unhandled);
    expect(seen).toEqual([1]); // item 1 was yielded before the failure surfaced
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('handles an empty input', async () => {
    const out: unknown[] = [];
    for await (const v of prefetch([], 4, async (x) => x)) out.push(v);
    expect(out).toEqual([]);
  });
});

describe('withRetry', () => {
  it('retries retryable failures and eventually succeeds', async () => {
    let calls = 0;
    const v = await withRetry(
      async () => {
        if (++calls < 3) throw new HttpError(503, 'unavailable');
        return 'ok';
      },
      { baseMs: 1, random: () => 0 },
    );
    expect(v).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError(413, 'too large');
        },
        { baseMs: 1, random: () => 0 },
      ),
    ).rejects.toThrow('too large');
    expect(calls).toBe(1);
  });

  it('honours the attempt cap', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError(500, 'nope');
        },
        { attempts: 3, baseMs: 1, random: () => 0 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it('rejects promptly on abort instead of sleeping out the backoff', async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = withRetry(
      async () => {
        throw new HttpError(500, 'nope');
      },
      { attempts: 5, baseMs: 5_000, capMs: 5_000, signal: ac.signal, random: () => 1 },
    );
    setTimeout(() => ac.abort(new Error('cancelled')), 10);
    await expect(p).rejects.toThrow('cancelled');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
