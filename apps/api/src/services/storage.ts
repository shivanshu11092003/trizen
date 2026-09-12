import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@photos/shared';
import type { Env } from '../types.js';

const SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

let cachedUrl: string | undefined;
let cachedKey: string | undefined;
let cachedClient: SupabaseClient | undefined;

function supabaseFor(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): SupabaseClient {
  if (!cachedClient || cachedUrl !== env.SUPABASE_URL || cachedKey !== env.SUPABASE_SERVICE_ROLE_KEY) {
    cachedUrl = env.SUPABASE_URL;
    cachedKey = env.SUPABASE_SERVICE_ROLE_KEY;
    cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return cachedClient;
}

export async function createSignedUpload(
  env: Env,
  storageKey: string,
): Promise<{ url: string; expiresAt: number }> {
  const { data, error } = await supabaseFor(env)
    .storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUploadUrl(storageKey);
  if (error || !data?.signedUrl) {
    console.error('Supabase signed upload failed', error);
    throw new AppError('UPLOAD_FAILED', 'Could not reserve storage for this photograph.');
  }
  return { url: data.signedUrl, expiresAt: Date.now() + SIGNED_UPLOAD_TTL_MS };
}

const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');

/** Fetches a private object only after an application authorization check. */
export async function getStorageObject(
  env: Env,
  storageKey: string,
  variant: 'thumb' | 'preview' | 'full' = 'full',
): Promise<Response | null> {
  const transformed = variant !== 'full';
  const route = transformed ? 'render/image/authenticated' : 'object/authenticated';
  const url = new URL(
    `${env.SUPABASE_URL}/storage/v1/${route}/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/${encodePath(storageKey)}`,
  );
  if (variant === 'thumb') {
    url.searchParams.set('width', '480');
    url.searchParams.set('quality', '76');
    url.searchParams.set('resize', 'contain');
  } else if (variant === 'preview') {
    url.searchParams.set('width', '1600');
    url.searchParams.set('quality', '84');
    url.searchParams.set('resize', 'contain');
  }

  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error('Supabase Storage download failed', response.status, await response.text());
    throw new AppError('INTERNAL', 'Storage is temporarily unavailable.');
  }
  return response;
}

export async function deleteStorageObjects(env: Env, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabaseFor(env).storage.from(env.SUPABASE_STORAGE_BUCKET).remove(paths);
  if (error) throw error;
}

export async function storageReady(env: Env): Promise<boolean> {
  const { data, error } = await supabaseFor(env).storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  return !error && Boolean(data);
}

export const storageKeyFor = (eventId: string, photoId: string, filename: string): string => {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : 'jpg';
  return `events/${eventId}/photos/${photoId}.${ext.replace(/[^a-z0-9]/g, '') || 'jpg'}`;
};
