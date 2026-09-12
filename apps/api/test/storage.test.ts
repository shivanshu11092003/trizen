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

  it('creates stable event-scoped object paths', () => {
    expect(storageKeyFor('event-id', 'photo-id', 'Portrait.JPEG')).toBe('events/event-id/photos/photo-id.jpeg');
  });
});
