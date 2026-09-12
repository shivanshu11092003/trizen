import { AppError } from '@photos/shared';
import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { gallerySessions, sessions, users } from '../db/schema.js';
import { hashWithPepper, sha256Hex } from '../lib/crypto.js';
import { sessionToken, ulid } from '../lib/ids.js';
import type { AppBindings, GalleryPrincipal, SessionPrincipal } from '../types.js';

export const IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, slides
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, never slides
const TOUCH_INTERVAL_MS = 5 * 60 * 1000; // do not write to Postgres on every request

export const GALLERY_IDLE_MS = 2 * 60 * 60 * 1000;
export const GALLERY_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

const clientIp = (c: Context<AppBindings>) =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

/**
 * Creates a session row and returns the raw token, which exists here and in the
 * response cookie and nowhere else. Only sha256(token) is stored, so a leaked
 * database backup grants nobody a session.
 */
export async function createSession(
  c: Context<AppBindings>,
  userId: string,
): Promise<{ token: string; csrfToken: string; sessionId: string; maxAge: number }> {
  const db = c.get('db');
  const now = Date.now();
  const token = sessionToken();
  const csrfToken = sessionToken();

  const id = ulid(now);
  await db.insert(sessions).values({
    id,
    userId,
    tokenHash: await sha256Hex(token),
    csrfToken,
    userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
    ipHash: await hashWithPepper(clientIp(c), c.env.IP_HASH_PEPPER),
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: now + IDLE_MS,
    absoluteExpiresAt: now + ABSOLUTE_MS,
  });

  return { token, csrfToken, sessionId: id, maxAge: Math.floor(IDLE_MS / 1000) };
}

/** One primary-key read, then the principal is on the context. */
export async function resolveSession(
  c: Context<AppBindings>,
  token: string,
): Promise<SessionPrincipal | null> {
  const db = c.get('db');
  const now = Date.now();
  const tokenHash = await sha256Hex(token);

  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      email: users.email,
      displayName: users.displayName,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Slide the idle window, but at most once every 5 minutes: an active session
  // must not write to Postgres on every request.
  if (now - row.lastSeenAt > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, idleExpiresAt: now + IDLE_MS })
      .where(eq(sessions.id, row.id));
  }

  return {
    sessionId: row.id,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    isPlatformAdmin: row.isPlatformAdmin,
    csrfToken: row.csrfToken,
  };
}

export async function revokeSession(c: Context<AppBindings>, sessionId: string): Promise<void> {
  // Delete the row, not a flag. Revocation should leave nothing behind.
  await c.get('db').delete(sessions).where(eq(sessions.id, sessionId));
}

/** Signs out every other device. The caller's own session survives on purpose. */
export async function revokeOtherSessions(
  c: Context<AppBindings>,
  userId: string,
  keepId: string,
): Promise<number> {
  const removed = await c
    .get('db')
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)))
    .returning({ id: sessions.id });
  return removed.length;
}

/* ------------------------------------------------------------------ *
 * Gallery sessions
 * ------------------------------------------------------------------ */

export async function createGallerySession(
  c: Context<AppBindings>,
  galleryId: string,
): Promise<{ token: string; maxAge: number }> {
  const db = c.get('db');
  const now = Date.now();
  const token = sessionToken();

  await db.insert(gallerySessions).values({
    id: ulid(now),
    galleryId,
    tokenHash: await sha256Hex(token),
    ipHash: await hashWithPepper(clientIp(c), c.env.IP_HASH_PEPPER),
    userAgentHash: await hashWithPepper(c.req.header('user-agent') ?? '', c.env.IP_HASH_PEPPER),
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: now + GALLERY_IDLE_MS,
    absoluteExpiresAt: now + GALLERY_ABSOLUTE_MS,
  });

  return { token, maxAge: Math.floor(GALLERY_IDLE_MS / 1000) };
}

export async function resolveGallerySession(
  c: Context<AppBindings>,
  token: string,
  galleryId: string,
): Promise<{ id: string } | null> {
  const now = Date.now();
  const [row] = await c
    .get('db')
    .select({ id: gallerySessions.id, lastSeenAt: gallerySessions.lastSeenAt })
    .from(gallerySessions)
    .where(
      and(
        eq(gallerySessions.tokenHash, await sha256Hex(token)),
        // The browser already path-scopes the cookie. Check anyway.
        eq(gallerySessions.galleryId, galleryId),
        isNull(gallerySessions.revokedAt),
        gt(gallerySessions.idleExpiresAt, now),
        gt(gallerySessions.absoluteExpiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (now - row.lastSeenAt > TOUCH_INTERVAL_MS) {
    await c
      .get('db')
      .update(gallerySessions)
      .set({ lastSeenAt: now, idleExpiresAt: now + GALLERY_IDLE_MS })
      .where(eq(gallerySessions.id, row.id));
  }
  return { id: row.id };
}

/** Rotating the PIN, unpublishing, or expiring must lock out everyone already in. */
export async function revokeGallerySessions(c: Context<AppBindings>, galleryId: string): Promise<void> {
  await c.get('db').delete(gallerySessions).where(eq(gallerySessions.galleryId, galleryId));
}

/** Cron sweep: expired rows are dead weight, and pin_attempts is append-only. */
export async function sweepExpiredSessions(db: AppBindings['Variables']['db']): Promise<void> {
  const now = Date.now();
  await db.delete(sessions).where(or(lt(sessions.absoluteExpiresAt, now), lt(sessions.idleExpiresAt, now)));
  await db
    .delete(gallerySessions)
    .where(or(lt(gallerySessions.absoluteExpiresAt, now), lt(gallerySessions.idleExpiresAt, now)));
}

export const unauthenticated = () =>
  new AppError('UNAUTHENTICATED', 'Sign in to continue.');

export type { GalleryPrincipal };
