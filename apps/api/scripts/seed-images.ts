import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { mapPool, withRetry } from '@photos/shared';
import { photos } from '../src/db/schema.js';
import { closeDatabase, databaseFor, type Database } from '../src/services/database.js';
import { fixedId } from './seed-ids.js';

/** Repair only known demo rows; never replace an existing Storage object. */
export async function seedImages(db: Database): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_STORAGE_BUCKET) {
    throw new Error('Supabase URL, server key, and storage bucket are required to seed images.');
  }
  const storage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(SUPABASE_STORAGE_BUCKET);
  const eventId = fixedId(10);
  const prefix = `events/${eventId}/photos`;
  const rows = await db.select({ id: photos.id, storageKey: photos.storageKey }).from(photos)
    .where(and(eq(photos.eventId, eventId), inArray(photos.id,
      Array.from({ length: 1250 }, (_, index) => fixedId(1000 + index)))));
  const existing = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const object of data) existing.add(`${prefix}/${object.name}`);
    if (data.length < 1000) break;
  }

  // The checked-in contact sheet contains six demo frames in a 3-by-2 grid.
  const source = fileURLToPath(new URL('../../web/public/assets/wedding-contact-sheet.png', import.meta.url).href);
  const metadata = await sharp(source).metadata();
  const cellWidth = Math.floor(metadata.width! / 3);
  const cellHeight = Math.floor(metadata.height! / 2);
  const frames = await Promise.all(Array.from({ length: 6 }, (_, index) => sharp(source)
    .extract({ left: (index % 3) * cellWidth + 8, top: Math.floor(index / 3) * cellHeight + 8,
      width: cellWidth - 16, height: cellHeight - 16 })
    .jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true })));
  const frameIndex = new Map(Array.from({ length: 1250 }, (_, index) => [fixedId(1000 + index), index % 6]));
  const missing = rows.filter(row => row.storageKey === `${prefix}/${row.id}.jpg` && !existing.has(row.storageKey));
  console.log(`Uploading ${missing.length} missing demo photographs (${existing.size} objects already present).`);
  const results = await mapPool(missing, 8, async (row) => {
    const frame = frames[frameIndex.get(row.id)!]!;
    await withRetry(async () => {
      const { error } = await storage.upload(row.storageKey, frame.data, {
        contentType: 'image/jpeg', upsert: false,
      });
      // A retry after a lost upload response must not overwrite the object.
      if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw error;
    }, { attempts: 3, isRetryable: (error) => error instanceof TypeError ||
      (typeof error === 'object' && error !== null && 'statusCode' in error &&
        (Number(error.statusCode) >= 500 || Number(error.statusCode) === 429)) });
    await db.update(photos).set({ fileSize: frame.data.length, width: frame.info.width,
      height: frame.info.height, contentType: 'image/jpeg' }).where(eq(photos.id, row.id));
  }, { onSettled: (done, total) => { if (done % 100 === 0 || done === total) console.log(`Demo photographs: ${done}/${total}`); } });
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new Error(`${failures.length} demo image uploads failed. Rerun db:seed:images to retry.`);
  console.log('Demo photograph storage is ready.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const db = databaseFor({ DATABASE_URL: process.env.DATABASE_URL });
  try { await seedImages(db); } finally { await closeDatabase(db); }
}
