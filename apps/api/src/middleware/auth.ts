import { AppError } from '@photos/shared';
import { and, eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { eventMembers } from '../db/schema.js';
import { CSRF_COOKIE, readSessionCookie } from '../lib/cookies.js';
import { resolveSession } from '../services/sessions.js';
import type { AppBindings } from '../types.js';

/** Resolves the session cookie to a principal, or 401. */
export const sessionAuth = () =>
  createMiddleware<AppBindings>(async (c, next) => {
    if (c.get('session')) return next();
    const token = readSessionCookie(c);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');

    const principal = await resolveSession(c, token);
    if (!principal) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');

    c.set('session', principal);
    await next();
  });

/** Populates the session when present, but never rejects. For /auth/me. */
export const optionalSession = () =>
  createMiddleware<AppBindings>(async (c, next) => {
    const token = readSessionCookie(c);
    if (token) {
      const principal = await resolveSession(c, token);
      if (principal) c.set('session', principal);
    }
    await next();
  });

/**
 * Double-submit CSRF. Cookie auth makes this a real attack, not a theoretical
 * one: the session cookie rides along on a cross-site form post, but a
 * cross-site page cannot read our csrf cookie to echo it back in a header.
 */
export const csrfGuard = () =>
  createMiddleware<AppBindings>(async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      throw new AppError('CSRF_FAILED', 'This request did not come from the app.');
    }

    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && origin !== c.env.PUBLIC_ORIGIN) {
      throw new AppError('CSRF_FAILED', 'This request did not come from the app.');
    }

    // This guard runs before route middleware. Resolve an existing team cookie
    // here so CSRF cannot be skipped merely because sessionAuth has not run yet.
    // sessionAuth reuses this principal, keeping the lookup to one Postgres read.
    let session = c.get('session');
    if (!session) {
      const token = readSessionCookie(c);
      if (token) {
        session = (await resolveSession(c, token)) ?? undefined;
        if (session) c.set('session', session);
      }
    }

    // Public unlock has no team cookie and is guarded by PIN rate limiting.
    if (session) {
      const header = c.req.header('x-csrf-token');
      const cookie = getCookie(c, CSRF_COOKIE);
      if (!header || header !== session.csrfToken || cookie !== session.csrfToken) {
        throw new AppError('CSRF_FAILED', 'Your session token is stale. Reload the page and try again.');
      }
    }

    await next();
  });

/**
 * The authorization spine. Membership is per-event, so "user attempts to access
 * another event" is this one join rather than a special case scattered around.
 *
 * A non-member gets 404, not 403: confirming that an event exists is itself a
 * leak. A member who lacks the *role* gets 403, because they already know it
 * exists.
 */
export const requireEventRole = (required: 'admin' | 'member') =>
  createMiddleware<AppBindings>(async (c, next) => {
    const session = c.get('session');
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');

    const eventId = c.req.param('eventId') ?? c.req.param('id');
    if (!eventId) throw new AppError('NOT_FOUND', 'Event not found.');

    const [membership] = await c
      .get('db')
      .select({ role: eventMembers.role })
      .from(eventMembers)
      .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.userId, session.userId)))
      .limit(1);

    if (!membership) throw new AppError('NOT_FOUND', 'Event not found.');

    if (required === 'admin' && membership.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Only the event lead can do that.');
    }

    c.set('eventRole', membership.role);
    await next();
  });
