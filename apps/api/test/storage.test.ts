import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorageObject, storageKeyFor } from '../src/services/storage.js';
import type { Env } from '../src/types.js';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
  SUPABASE_STORAGE_BUCKET: 'photos-originals',
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe('Supabase Storage adapter', () => {
  it('fetches an authenticated private thumbnail with bounded transforms', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response('image', { headers: { 'content-type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await getStorageObject(env, 'events/event one/photos/a.jpg', 'thumb');
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(response?.headers.get('content-type')).toBe('image/webp');
    expect(String(url)).toContain('/storage/v1/render/image/authenticated/photos-originals/events/event%20one/photos/a.jpg');
    expect(String(url)).toContain('width=480');
    expect(init?.headers).toMatchObject({ apikey: 'service-secret', Authorization: 'Bearer service-secret' });
  });

  it('returns null for an object missing from the private bucket', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(getStorageObject(env, 'missing.jpg')).resolves.toBeNull();
  });

  it('recognizes a missing object reported as HTTP 400 with a 404 payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      statusCode: '404', code: 'NoSuchKey', message: 'Object not found',
    }, { status: 400 })));
    await expect(getStorageObject(env, 'missing.jpg')).resolves.toBeNull();
  });

  it('falls back to the authenticated original when transformation is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Feature not enabled' }, { status: 403 }))
      .mockResolvedValueOnce(new Response('original image', { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await getStorageObject(env, 'events/event one/photos/a.jpg', 'preview');
    expect(await response?.text()).toBe('original image');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('https://project.supabase.co/storage/v1/object/authenticated/photos-originals/events/event%20one/photos/a.jpg');
    expect(init.headers).toEqual({ apikey: 'service-secret', Authorization: 'Bearer service-secret' });
  });

  it('does not mistake an authorization error for a missing photo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ statusCode: '403', error: 'Unauthorized' }, { status: 400 })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(getStorageObject(env, 'private.jpg', 'thumb')).rejects.toThrow('Storage is temporarily unavailable.');
    } finally { log.mockRestore(); }
  });

  it('creates stable event-scoped object paths', () => {
    expect(storageKeyFor('event-id', 'photo-id', 'Portrait.JPEG')).toBe('events/event-id/photos/photo-id.jpeg');
  });
});
