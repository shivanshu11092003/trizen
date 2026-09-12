import { AppError } from '@photos/shared';
import { eq, sql } from 'drizzle-orm';
import { rateLimits } from '../db/schema.js';
import type { AppBindings } from '../types.js';
import type { Context } from 'hono';

/**
 * Fixed-window counter in Postgres. Not as precise as a sliding window, but it is one
 * upsert, it survives a Worker restart, and it is honest about what it does.
 */
export async function enforceRateLimit(
  c: Context<AppBindings>,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ remaining: number }> {
  const db = c.get('db');
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        // Same window: increment. New window: reset to 1.
        count: sql`CASE WHEN ${rateLimits.windowStart} = ${windowStart} THEN ${rateLimits.count} + 1 ELSE 1 END`,
        windowStart,
      },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > limit) {
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    throw new AppError('RATE_LIMITED', `Too many attempts. Try again in ${retryAfter} seconds.`, {
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
  return { remaining: Math.max(0, limit - count) };
}

export async function sweepRateLimits(c: Context<AppBindings>, olderThanMs: number): Promise<void> {
  await c
    .get('db')
    .delete(rateLimits)
    .where(sql`${rateLimits.windowStart} < ${Date.now() - olderThanMs}`);
}

export { eq };
