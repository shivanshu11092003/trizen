import { apiRouter } from '../lib/openapi.js';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  AddMemberBody,
  AppError,
  AuditEntry,
  CreateEventBody,
  Email,
  Event,
  EventMember,
  EventStats,
  PaginationQuery,
  Ulid,
  page,
} from '@photos/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { auditLog, eventMembers, events, galleries, photos, users } from '../db/schema.js';
import { hashSecret } from '../lib/crypto.js';
import { ulid } from '../lib/ids.js';
import { paginate } from '../lib/keyset.js';
import type { SortSpec } from '../lib/keyset.js';
import { authErrors, err, listErrors, ok } from '../lib/openapi.js';
import { requireEventRole, sessionAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import type { AppBindings } from '../types.js';

export const eventRoutes = apiRouter();

type EventCursorRow = { id: string; createdAt: number };
const eventSort: SortSpec<EventCursorRow> = {
  id: 'events:newest',
  keys: [
    { column: events.createdAt, dir: 'desc', read: (r) => r.createdAt },
    { column: events.id, dir: 'desc', read: (r) => r.id },
  ],
};

type AuditCursorRow = { id: string; createdAt: number };
const auditSort: SortSpec<AuditCursorRow> = {
  id: 'audit:newest',
  keys: [
    { column: auditLog.createdAt, dir: 'desc', read: (r) => r.createdAt },
    { column: auditLog.id, dir: 'desc', read: (r) => r.id },
  ],
};

/* -------------------------------- create -------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events',
    tags: ['Events'],
    summary: 'Create an event',
    description: 'The creator becomes its admin. Only platform admins can create events.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { body: { content: { 'application/json': { schema: CreateEventBody } }, required: true } },
    responses: { 201: ok(Event, 'Created.'), ...authErrors, 422: err('Validation failed.') },
  }),
  async (c) => {
    const s = c.get('session')!;
    if (!s.isPlatformAdmin) throw new AppError('FORBIDDEN', 'Only a lead can create events.');

    const body = c.req.valid('json');
    const now = Date.now();
    const id = ulid(now);
    const db = c.get('db');

    await db.insert(events).values({
      id,
      name: body.name,
      description: body.description ?? null,
      eventDate: body.eventDate ?? null,
      ownerId: s.userId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(eventMembers).values({
      eventId: id,
      userId: s.userId,
      role: 'admin',
      addedBy: s.userId,
      addedAt: now,
    });
    await audit(c, { action: 'event.created', eventId: id, targetType: 'event', targetId: id });

    return c.json(
      {
        id,
        name: body.name,
        description: body.description ?? null,
        eventDate: body.eventDate ?? null,
        ownerId: s.userId,
        status: 'active' as const,
        role: 'admin' as const,
        createdAt: now,
        updatedAt: now,
      },
      201,
    );
  },
);

/* --------------------------------- list --------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events',
    tags: ['Events'],
    summary: 'List my events',
    description: 'Only events you are a member of. Cursor-paginated, newest first.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { query: PaginationQuery },
    responses: { 200: ok(page(Event), 'A page of events.'), ...authErrors, ...listErrors },
  }),
  async (c) => {
    const s = c.get('session')!;
    const { limit, cursor } = c.req.valid('query');
    const db = c.get('db');

    const result = await paginate({
      spec: eventSort,
      // Tenancy lives here, composed by the caller. A cursor can never widen it.
      where: eq(eventMembers.userId, s.userId),
      limit,
      cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) =>
        db
          .select({
            id: events.id,
            name: events.name,
            description: events.description,
            eventDate: events.eventDate,
            ownerId: events.ownerId,
            status: events.status,
            role: eventMembers.role,
            createdAt: events.createdAt,
            updatedAt: events.updatedAt,
          })
          .from(events)
          .innerJoin(eventMembers, eq(eventMembers.eventId, events.id))
          .where(where)
          .orderBy(...order)
          .limit(take),
    });

    return c.json(result, 200);
  },
);

/* ---------------------------------- get --------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}',
    tags: ['Events'],
    summary: 'Get one event',
    description: 'A non-member gets 404, not 403: confirming an event exists is itself a leak.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: { params: z.object({ eventId: Ulid }) },
    responses: { 200: ok(Event, 'The event.'), ...authErrors, 404: err('No such event, or not yours.') },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const [row] = await c.get('db').select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', 'Event not found.');
    return c.json({ ...row, role: c.get('eventRole')! }, 200);
  },
);

/* --------------------------------- stats -------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}/stats',
    tags: ['Events'],
    summary: 'Event totals',
    description:
      'Counts live here, deliberately away from the paginated list endpoints, so a page fetch ' +
      'never pays for a COUNT(*) over 1,250 rows.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: { params: z.object({ eventId: Ulid }) },
    responses: { 200: ok(EventStats, 'Totals for the event.'), ...authErrors, 404: err('No such event.') },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const db = c.get('db');

    const [totals] = await db
      .select({
        totalPhotos: count(),
        readyPhotos: sql<number>`SUM(CASE WHEN ${photos.status} = 'ready' THEN 1 ELSE 0 END)`.mapWith(Number),
        selectedPhotos: sql<number>`SUM(CASE WHEN ${photos.isSelected} = true THEN 1 ELSE 0 END)`.mapWith(Number),
        storageBytes: sql<number>`COALESCE(SUM(${photos.fileSize}), 0)`.mapWith(Number),
      })
      .from(photos)
      .where(and(eq(photos.eventId, eventId), sql`${photos.status} != 'deleted'`,
        c.get('eventRole') === 'member' ? eq(photos.uploadedBy, c.get('session')!.userId) : undefined));

    const uploaders = await db
      .select({ userId: users.id, displayName: users.displayName, count: count() })
      .from(photos)
      .innerJoin(users, eq(users.id, photos.uploadedBy))
      .where(and(eq(photos.eventId, eventId), eq(photos.status, 'ready'),
        c.get('eventRole') === 'member' ? eq(photos.uploadedBy, c.get('session')!.userId) : undefined))
      .groupBy(users.id, users.displayName);

    const [g] = await db.select({ n: count() }).from(galleries).where(eq(galleries.eventId, eventId));

    return c.json({
      totalPhotos: totals?.totalPhotos ?? 0,
      readyPhotos: Number(totals?.readyPhotos ?? 0),
      selectedPhotos: Number(totals?.selectedPhotos ?? 0),
      storageBytes: Number(totals?.storageBytes ?? 0),
      galleries: g?.n ?? 0,
      uploaders,
    }, 200);
  },
);

/* -------------------------------- members ------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events/{eventId}/members',
    tags: ['Members'],
    summary: 'Add a team member',
    description:
      'Creates the account if the email is new and returns a one-time password for the demo. ' +
      'A real deployment would email an invite link instead; see the README.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      body: { content: { 'application/json': { schema: AddMemberBody } }, required: true },
    },
    responses: {
      201: ok(
        EventMember.extend({ temporaryPassword: z.string().optional() }),
        'Added. A temporary password appears only when a new account was created.',
      ),
      409: err('Already a member of this event.'),
      ...authErrors,
      404: err('No such event.'),
    },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const now = Date.now();

    let [user] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    let temporaryPassword: string | undefined;
    if (!user) {
      temporaryPassword = `${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const id = ulid(now);
      await db.insert(users).values({
        id,
        email: body.email,
        passwordHash: await hashSecret(temporaryPassword, c.env.PIN_PEPPER),
        displayName: body.displayName ?? body.email.split('@')[0]!,
        isPlatformAdmin: false,
        createdAt: now,
        updatedAt: now,
      });
      user = { id, email: body.email, displayName: body.displayName ?? body.email.split('@')[0]! };
    }

    const [existing] = await db
      .select({ userId: eventMembers.userId })
      .from(eventMembers)
      .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.userId, user.id)))
      .limit(1);
    if (existing) throw new AppError('CONFLICT', `${user.email} is already on this event.`);

    await db.insert(eventMembers).values({
      eventId,
      userId: user.id,
      role: body.role,
      addedBy: c.get('session')!.userId,
      addedAt: now,
    });
    await audit(c, { action: 'member.added', eventId, targetType: 'user', targetId: user.id, metadata: { role: body.role } });

    return c.json(
      {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: body.role,
        addedAt: now,
        photoCount: 0,
        ...(temporaryPassword ? { temporaryPassword } : {}),
      },
      201,
    );
  },
);

eventRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}/members',
    tags: ['Members'],
    summary: 'List team members',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: { params: z.object({ eventId: Ulid }), query: PaginationQuery },
    responses: { 200: ok(page(EventMember), 'A page of members.'), ...authErrors, ...listErrors },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { limit, cursor } = c.req.valid('query');
    const db = c.get('db');

    const result = await paginate<z.infer<typeof EventMember>>({
      spec: {
        id: 'members:newest',
        keys: [
          { column: eventMembers.addedAt, dir: 'desc', read: (r: { addedAt: number }) => r.addedAt },
          { column: eventMembers.userId, dir: 'desc', read: (r: { userId: string }) => r.userId },
        ],
      },
      where: eq(eventMembers.eventId, eventId),
      limit,
      cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) =>
        db
          .select({
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
            role: eventMembers.role,
            addedAt: eventMembers.addedAt,
            photoCount: sql<number>`(
              SELECT COUNT(*) FROM ${photos}
              WHERE ${photos.eventId} = ${eventMembers.eventId}
                AND ${photos.uploadedBy} = ${eventMembers.userId}
                AND ${photos.status} = 'ready'
            )`.mapWith(Number),
          })
          .from(eventMembers)
          .innerJoin(users, eq(users.id, eventMembers.userId))
          .where(where)
          .orderBy(...order)
          .limit(take),
    });

    return c.json(result, 200);
  },
);

eventRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/events/{eventId}/members/{userId}',
    tags: ['Members'],
    summary: 'Remove a team member',
    description:
      'Takes effect on their next request -- sessions are rows, so there is no token left to expire. ' +
      'The last admin cannot be removed.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: { params: z.object({ eventId: Ulid, userId: Ulid }) },
    responses: {
      204: { description: 'Removed.' },
      409: err('That is the last admin on this event.'),
      ...authErrors,
      404: err('Not a member of this event.'),
    },
  }),
  async (c) => {
    const { eventId, userId } = c.req.valid('param');
    const db = c.get('db');

    const [target] = await db
      .select({ role: eventMembers.role })
      .from(eventMembers)
      .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.userId, userId)))
      .limit(1);
    if (!target) throw new AppError('NOT_FOUND', 'They are not on this event.');

    if (target.role === 'admin') {
      const [admins] = await db
        .select({ n: count() })
        .from(eventMembers)
        .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.role, 'admin')));
      if ((admins?.n ?? 0) <= 1) {
        throw new AppError('CONFLICT', 'An event needs at least one lead. Promote someone else first.');
      }
    }

    await db
      .delete(eventMembers)
      .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.userId, userId)));
    await audit(c, { action: 'member.removed', eventId, targetType: 'user', targetId: userId });

    return c.body(null, 204);
  },
);

/* --------------------------------- audit -------------------------------- */

eventRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}/audit',
    tags: ['Events'],
    summary: 'Audit log',
    description: 'Who did what on this event. Cursor-paginated, newest first.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: { params: z.object({ eventId: Ulid }), query: PaginationQuery },
    responses: { 200: ok(page(AuditEntry), 'A page of audit entries.'), ...authErrors, ...listErrors },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { limit, cursor } = c.req.valid('query');
    const db = c.get('db');

    const result = await paginate({
      spec: auditSort,
      where: eq(auditLog.eventId, eventId),
      limit,
      cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) =>
        db
          .select({
            id: auditLog.id,
            actorName: users.displayName,
            action: auditLog.action,
            targetType: auditLog.targetType,
            targetId: auditLog.targetId,
            metadata: auditLog.metadata,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorId))
          .where(where)
          .orderBy(...order)
          .limit(take),
    });

    return c.json({
      ...result,
      data: result.data.map((r) => ({
        ...r,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
      })),
    }, 200);
  },
);
