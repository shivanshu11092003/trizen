import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, InvalidCursorError, type CursorPayload } from '../src/index.js';

const SECRET = 'test-cursor-secret-value';
const payload: CursorPayload = { v: 1, k: [1735689600000, '01J8XZ'], d: 'next', s: 'photos:newest' };

describe('cursor codec', () => {
  it('round-trips a payload', async () => {
    const c = await encodeCursor(payload, SECRET);
    await expect(decodeCursor(c, 'photos:newest', SECRET)).resolves.toEqual(payload);
  });

  it('is opaque: the body is not readable as plain JSON', async () => {
    const c = await encodeCursor(payload, SECRET);
    expect(c).not.toContain('photos:newest');
    expect(c).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a tampered body', async () => {
    const c = await encodeCursor(payload, SECRET);
    const [body, sig] = c.split('.');
    const forged = `${body!.slice(0, -2)}AA.${sig}`;
    await expect(decodeCursor(forged, 'photos:newest', SECRET)).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('rejects a cursor signed with a different secret', async () => {
    const c = await encodeCursor(payload, 'another-secret');
    await expect(decodeCursor(c, 'photos:newest', SECRET)).rejects.toThrow(/signature/i);
  });

  it('rejects a cursor minted for a different sort order', async () => {
    const c = await encodeCursor(payload, SECRET);
    await expect(decodeCursor(c, 'photos:filename', SECRET)).rejects.toThrow(/different sort order/i);
  });

  it('rejects malformed input without throwing something unexpected', async () => {
    for (const bad of ['', '.', 'nodot', 'a.', 'a.b', '!!.$$']) {
      await expect(decodeCursor(bad, 'photos:newest', SECRET)).rejects.toBeInstanceOf(InvalidCursorError);
    }
  });

  it('rejects an unsupported cursor version', async () => {
    const c = await encodeCursor({ ...payload, v: 2 as unknown as 1 }, SECRET);
    await expect(decodeCursor(c, 'photos:newest', SECRET)).rejects.toThrow(/version/i);
  });

  it('carries null key values for nullable sort columns', async () => {
    const p: CursorPayload = { v: 1, k: [null, '01J8XZ'], d: 'next', s: 'photos:taken' };
    const c = await encodeCursor(p, SECRET);
    await expect(decodeCursor(c, 'photos:taken', SECRET)).resolves.toEqual(p);
  });
});
