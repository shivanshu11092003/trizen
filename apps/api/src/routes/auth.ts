import { apiRouter } from '../lib/openapi.js';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  AppError,
  LoginBody,
  Me,
  RegisterBody,
  SessionSummary,
  Ulid,
} from '@photos/shared';
import { and, desc, eq } from 'drizzle-orm';
import { eventMembers, events, sessions, users } from '../db/schema.js';
import {
  clearCsrfCookie,
  clearSessionCookie,
  setCsrfCookie,
  setSessionCookie,
} from '../lib/cookies.js';
import { hashSecret, verifySecret } from '../lib/crypto.js';
import { ulid } from '../lib/ids.js';
import { authErrors, err, ok } from '../lib/openapi.js';
import { sessionAuth } from '../middleware/auth.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import { createSession, revokeOtherSessions, revokeSession } from '../services/sessions.js';
import type { AppBindings } from '../types.js';
import { audit } from '../services/audit.js';

export const authRoutes = apiRouter();

async function loadMe(c: Parameters<typeof createSession>[0], userId: string) {
  const rows = await c
    .get('db')
    .select({ eventId: eventMembers.eventId, eventName: events.name, role: eventMembers.role })
    .from(eventMembers)
    .innerJoin(events, eq(events.id, eventMembers.eventId))
    .where(eq(eventMembers.userId, userId));
  return rows;
}

/* ------------------------------- register ------------------------------- */

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/register',
    tags: ['Auth'],
    summary: 'Create an account',
    description:
      'Creates a platform account and signs it in. The first account you create is the Admin/Lead; ' +
      'team members are normally created through an event invite instead.',
    request: { body: { content: { 'application/json': { schema: RegisterBody } }, required: true } },
    responses: {
      201: ok(Me, 'Account created and signed in.'),
      409: err('That email is already registered.'),
      422: err('The email or password failed validation.'),
      429: err('Too many attempts from this address.'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    await enforceRateLimit(c, `register:${c.req.header('cf-connecting-ip') ?? 'local'}`, 10, 60 * 60 * 1000);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw new AppError('CONFLICT', 'That email is already registered. Sign in instead.');

    const now = Date.now();
    const id = ulid(now);
    await db.insert(users).values({
      id,
      email: body.email,
      passwordHash: await hashSecret(body.password, c.env.PIN_PEPPER),
      displayName: body.displayName,
      isPlatformAdmin: true, // anyone who registers directly can create events
      createdAt: now,
      updatedAt: now,
    });

    const session = await createSession(c, id);
    setSessionCookie(c, session.token, session.maxAge);
    setCsrfCookie(c, session.csrfToken, session.maxAge);

    return c.json(
      {
        user: {
          id,
          email: body.email,
          displayName: body.displayName,
          isPlatformAdmin: true,
          createdAt: now,
        },
        memberships: [],
        csrfToken: session.csrfToken,
        sessionId: session.sessionId,
      },
      201,
    );
  },
);

/* --------------------------------- login -------------------------------- */

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/login',
    tags: ['Auth'],
    summary: 'Sign in',
    description:
      'Sets an httpOnly session cookie and a readable CSRF cookie. There is no bearer token: ' +
      'sessions are server-side rows, so signing out or being removed takes effect on the next request.',
    request: { body: { content: { 'application/json': { schema: LoginBody } }, required: true } },
    responses: {
      200: ok(Me, 'Signed in.'),
      401: err('Wrong email or password. The message is identical for both, on purpose.'),
      429: err('Too many attempts from this address.'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    await enforceRateLimit(c, `login:${c.req.header('cf-connecting-ip') ?? 'local'}`, 20, 15 * 60 * 1000);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        isPlatformAdmin: users.isPlatformAdmin,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    // Always run a verification, even with no user: identical work means
    // identical timing, so an attacker cannot enumerate registered emails.
    const dummy = 'pbkdf2p$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await verifySecret(body.password, user?.passwordHash ?? dummy, c.env.PIN_PEPPER);

    if (!user || !valid) throw new AppError('UNAUTHENTICATED', 'Wrong email or password.');

    // A new session id on every login: any pre-existing cookie value is
    // discarded rather than adopted, which closes session fixation.
    const session = await createSession(c, user.id);
    setSessionCookie(c, session.token, session.maxAge);
    setCsrfCookie(c, session.csrfToken, session.maxAge);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        createdAt: user.createdAt,
      },
      memberships: await loadMe(c, user.id),
      csrfToken: session.csrfToken,
      sessionId: session.sessionId,
    }, 200);
  },
);

/* ---------------------------------- me ---------------------------------- */

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me',
    tags: ['Auth'],
    summary: 'Who am I',
    description: 'The frontend calls this once on boot to hydrate its auth store. Never cached.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    responses: { 200: ok(Me, 'The signed-in user and their event memberships.'), ...authErrors },
  }),
  async (c) => {
    const s = c.get('session')!;
    const [user] = await c
      .get('db')
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, s.userId))
      .limit(1);

    return c.json({
      user: {
        id: s.userId,
        email: s.email,
        displayName: s.displayName,
        isPlatformAdmin: s.isPlatformAdmin,
        createdAt: user?.createdAt ?? 0,
      },
      memberships: await loadMe(c, s.userId),
      csrfToken: s.csrfToken,
      sessionId: s.sessionId,
    }, 200);
  },
);

/* -------------------------------- logout -------------------------------- */

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/logout',
    tags: ['Auth'],
    summary: 'Sign out',
    description: 'Deletes the session row. Not a flag, not a denylist -- the row.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    responses: { 204: { description: 'Signed out.' }, ...authErrors },
  }),
  async (c) => {
    await revokeSession(c, c.get('session')!.sessionId);
    clearSessionCookie(c);
    clearCsrfCookie(c);
    return c.body(null, 204);
  },
);

/* ------------------------------- sessions ------------------------------- */

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/sessions',
    tags: ['Auth'],
    summary: 'List active sessions',
    description: 'Every device currently signed in as you. "current" marks the one making this request.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    responses: { 200: ok(z.array(SessionSummary), 'Active sessions, most recent first.'), ...authErrors },
  }),
  async (c) => {
    const s = c.get('session')!;
    const rows = await c
      .get('db')
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        idleExpiresAt: sessions.idleExpiresAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, s.userId))
      .orderBy(desc(sessions.lastSeenAt));

    return c.json(rows.map((r) => ({ ...r, current: r.id === s.sessionId })), 200);
  },
);

authRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/auth/sessions/{id}',
    tags: ['Auth'],
    summary: 'End one session',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { params: z.object({ id: Ulid }) },
    responses: { 204: { description: 'That session is gone.' }, 404: err('No such session.'), ...authErrors },
  }),
  async (c) => {
    const s = c.get('session')!;
    const { id } = c.req.valid('param');
    const removed = await c
      .get('db')
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, s.userId)))
      .returning({ id: sessions.id });

    if (removed.length === 0) throw new AppError('NOT_FOUND', 'No such session.');
    if (id === s.sessionId) {
      clearSessionCookie(c);
      clearCsrfCookie(c);
    }
    return c.body(null, 204);
  },
);

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/sessions/revoke-all',
    tags: ['Auth'],
    summary: 'Sign out everywhere else',
    description: 'Ends every session except the one making this request.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    responses: { 200: ok(z.object({ revoked: z.number().int() }), 'How many sessions ended.'), ...authErrors },
  }),
  async (c) => {
    const s = c.get('session')!;
    const revoked = await revokeOtherSessions(c, s.userId, s.sessionId);
    await audit(c, { action: 'session.revoke_all', targetType: 'user', targetId: s.userId, metadata: { revoked } });
    return c.json({ revoked }, 200);
  },
);
