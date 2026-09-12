import { and, eq, lt } from 'drizzle-orm';
import { photos } from '../db/schema.js';
import type { Env } from '../types.js';
import type { Database } from './database.js';
import { deleteStorageObjects } from './storage.js';

const ORPHAN_AGE_MS = 60 * 60 * 1000;

/**
 * A failed upload leaves a `pending` row and possibly a partial Storage object.
 * Neither should outlive the attempt: phantom rows corrupt the photo count, and
 * orphaned objects are storage nobody is paying attention to.
 */
export async function reapOrphanUploads(
  db: Database,
  env: Env,
): Promise<{ reaped: number }> {
  const cutoff = Date.now() - ORPHAN_AGE_MS;

  const orphans = await db
    .delete(photos)
    .where(and(eq(photos.status, 'pending'), lt(photos.createdAt, cutoff)))
    .returning({ storageKey: photos.storageKey });

  // Best effort: the row is the source of truth, and a stray object costs
  // pennies. Never let a bucket error strand the rows.
  await deleteStorageObjects(env, orphans.map((o) => o.storageKey)).catch(() => undefined);

  return { reaped: orphans.length };
}
