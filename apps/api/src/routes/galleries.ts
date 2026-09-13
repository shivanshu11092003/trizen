import { apiRouter } from '../lib/openapi.js';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  AppError,
  CreateGalleryBody,
  Gallery,
  GalleryCredentials,
  PaginationQuery,
  PatchGalleryBody,
  Ulid,
  page,
} from '@photos/shared';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { eventMembers, galleries, galleryPhotos, photos } from '../db/schema.js';
import { hashSecret } from '../lib/crypto.js';
import { generatePin, gallerySlug, ulid } from '../lib/ids.js';
import { paginate } from '../lib/keyset.js';
import type { SortSpec } from '../lib/keyset.js';
import { authErrors, err, listErrors, ok } from '../lib/openapi.js';
import { requireEventRole, sessionAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { revokeGallerySessions } from '../services/sessions.js';
import type { AppBindings } from '../types.js';

export const galleryRoutes = apiRouter();

const galleryFields = {
  id: galleries.id,
  eventId: galleries.eventId,
  slug: galleries.slug,
  title: galleries.title,
  status: galleries.status,
  allowDownload: galleries.allowDownload,
  expiresAt: galleries.expiresAt,
  publishedAt: galleries.publishedAt,
  viewCount: galleries.viewCount,
  lastViewedAt: galleries.lastViewedAt,
  createdAt: galleries.createdAt,
  photoCount:
    sql<number>`(SELECT COUNT(*) FROM ${galleryPhotos} INNER JOIN ${photos} ON ${photos.id} = ${galleryPhotos.photoId} WHERE ${galleryPhotos.galleryId} = ${galleries.id} AND ${photos.status} = 'ready')`.mapWith(
      Number,
    ),
};

type GalleryRow = z.infer<typeof Gallery>;
const gallerySort: SortSpec<GalleryRow> = {
  id: 'galleries:newest',
  keys: [
    { column: galleries.createdAt, dir: 'desc', read: (row) => row.createdAt },
    { column: galleries.id, dir: 'desc', read: (row) => row.id },
  ],
};

/** Loads a gallery and proves the caller is a lead on its event. */
async function loadOwnedGallery(c: Parameters<typeof audit>[0], galleryId: string) {
  const s = c.get('session')!;
  const db = c.get('db');
  const [row] = await db
    .select({ gallery: galleries, memberRole: eventMembers.role })
    .from(galleries)
    .leftJoin(
      eventMembers,
      and(eq(eventMembers.eventId, galleries.eventId), eq(eventMembers.userId, s.userId)),
    )
    .where(eq(galleries.id, galleryId))
    .limit(1);
  if (!row || !row.memberRole) throw new AppError('NOT_FOUND', 'Gallery not found.');
  if (row.memberRole !== 'admin') throw new AppError('FORBIDDEN', 'Only the event lead manages galleries.');
  return row.gallery;
}

/* -------------------------------- create -------------------------------- */

galleryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events/{eventId}/galleries',
    tags: ['Galleries'],
    summary: 'Create a gallery',
    description:
      'Snapshots the chosen photos into the gallery and mints a URL and a 6-digit PIN. ' +
      '**The PIN is returned exactly once and is never readable again** -- store it or rotate it. ' +
      'The snapshot is deliberate: deselecting a photo afterwards does not change what the client ' +
      'already bookmarked.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      body: { content: { 'application/json': { schema: CreateGalleryBody } }, required: true },
    },
    responses: {
      201: ok(GalleryCredentials, 'Created. The PIN appears here and nowhere else.'),
      422: err('No photos chosen, or validation failed.'),
      ...authErrors,
      404: err('No such event.'),
    },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const body = c.req.valid('json');
    const s = c.get('session')!;
    const db = c.get('db');
    const now = Date.now();

    const chosen = body.useSelected
      ? await db
          .select({ id: photos.id })
          .from(photos)
          .where(and(eq(photos.eventId, eventId), eq(photos.isSelected, true), eq(photos.status, 'ready')))
          .orderBy(photos.createdAt, photos.id)
      : await db
          .select({ id: photos.id })
          .from(photos)
          .where(
            and(
              eq(photos.eventId, eventId),
              eq(photos.status, 'ready'),
              inArray(photos.id, body.photoIds ?? []),
            ),
          )
          .orderBy(photos.createdAt, photos.id);

    if (chosen.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Select at least one photo before publishing.', {
        details: [{ path: 'photoIds', message: 'No ready photos matched.' }],
      });
    }

    const id = ulid(now);
    const slug = gallerySlug();
    const pin = body.pin ?? generatePin();
    const pinHash = await hashSecret(pin, c.env.PIN_PEPPER);

    await db.transaction(async (tx) => {
      await tx.insert(galleries).values({
        id,
        eventId,
        slug,
        title: body.title,
        pinHash,
        pinSetAt: now,
        status: body.publish ? 'published' : 'draft',
        publishedAt: body.publish ? now : null,
        expiresAt: body.expiresAt ?? null,
        allowDownload: body.allowDownload,
        createdBy: s.userId,
        createdAt: now,
        updatedAt: now,
      });

      // Batch the snapshot: 600 individual inserts would be 600 round trips.
      for (let i = 0; i < chosen.length; i += 100) {
        await tx.insert(galleryPhotos).values(
          chosen.slice(i, i + 100).map((p, j) => ({
            galleryId: id,
            photoId: p.id,
            sortOrder: i + j,
            addedAt: now,
          })),
        );
      }
    });

    await audit(c, {
      action: body.publish ? 'gallery.published' : 'gallery.created',
      eventId,
      targetType: 'gallery',
      targetId: id,
      metadata: { photoCount: chosen.length },
    });

    return c.json(
      {
        gallery: {
          id,
          eventId,
          slug,
          title: body.title,
          status: body.publish ? ('published' as const) : ('draft' as const),
          photoCount: chosen.length,
          allowDownload: body.allowDownload,
          expiresAt: body.expiresAt ?? null,
          publishedAt: body.publish ? now : null,
          viewCount: 0,
          lastViewedAt: null,
          createdAt: now,
        },
        url: `${c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin}/gallery/${slug}`,
        pin,
      },
      201,
    );
  },
);

/* --------------------------------- list --------------------------------- */

galleryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}/galleries',
    tags: ['Galleries'],
    summary: 'List galleries for an event',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: { params: z.object({ eventId: Ulid }), query: PaginationQuery },
    responses: { 200: ok(page(Gallery), 'A page of galleries.'), ...authErrors, ...listErrors },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { limit, cursor } = c.req.valid('query');
    const db = c.get('db');

    const result = await paginate({
      spec: gallerySort,
      where: eq(galleries.eventId, eventId),
      limit,
      cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) =>
        db
          .select(galleryFields)
          .from(galleries)
          .where(where)
          .orderBy(...order)
          .limit(take),
    });

    return c.json(result, 200);
  },
);

/* --------------------------- publish / unpublish ------------------------ */

for (const [action, status] of [
  ['publish', 'published'],
  ['unpublish', 'unpublished'],
] as const) {
  galleryRoutes.openapi(
    createRoute({
      method: 'post',
      path: `/galleries/{galleryId}/${action}`,
      tags: ['Galleries'],
      summary: action === 'publish' ? 'Publish a gallery' : 'Unpublish a gallery',
      description:
        action === 'publish'
          ? 'Makes the link work. Team members cannot do this.'
          : 'Takes the link offline and ends every customer session already inside it.',
      security: [{ sessionAuth: [] }],
      middleware: [sessionAuth()] as const,
      request: { params: z.object({ galleryId: Ulid }) },
      responses: {
        200: ok(Gallery, 'The updated gallery.'),
        ...authErrors,
        404: err('No such gallery.'),
      },
    }),
    async (c) => {
      const { galleryId } = c.req.valid('param');
      const existing = await loadOwnedGallery(c, galleryId);
      const now = Date.now();

      await c
        .get('db')
        .update(galleries)
        .set({
          status,
          publishedAt: status === 'published' ? (existing.publishedAt ?? now) : existing.publishedAt,
          updatedAt: now,
        })
        .where(eq(galleries.id, galleryId));

      // Unpublishing must lock out anyone already inside.
      if (status === 'unpublished') await revokeGallerySessions(c, galleryId);

      await audit(c, {
        action: `gallery.${action}ed`,
        eventId: existing.eventId,
        targetType: 'gallery',
        targetId: galleryId,
      });

      const [row] = await c
        .get('db')
        .select(galleryFields)
        .from(galleries)
        .where(eq(galleries.id, galleryId));
      return c.json(row!, 200);
    },
  );
}

/* ------------------------------- rotate PIN ----------------------------- */

galleryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/galleries/{galleryId}/rotate-pin',
    tags: ['Galleries'],
    summary: 'Issue a new PIN',
    description:
      'Mints a new PIN and **ends every customer session already inside the gallery**, so the old ' +
      'PIN and anyone using it are locked out immediately. Shown once.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { params: z.object({ galleryId: Ulid }) },
    responses: {
      200: ok(z.object({ pin: z.string() }), 'The new PIN. This is the only time it is shown.'),
      ...authErrors,
      404: err('No such gallery.'),
    },
  }),
  async (c) => {
    const { galleryId } = c.req.valid('param');
    const existing = await loadOwnedGallery(c, galleryId);
    const pin = generatePin();
    const now = Date.now();

    await c
      .get('db')
      .update(galleries)
      .set({ pinHash: await hashSecret(pin, c.env.PIN_PEPPER), pinSetAt: now, updatedAt: now })
      .where(eq(galleries.id, galleryId));

    await revokeGallerySessions(c, galleryId);
    await audit(c, {
      action: 'gallery.pin_rotated',
      eventId: existing.eventId,
      targetType: 'gallery',
      targetId: galleryId,
    });

    return c.json({ pin }, 200);
  },
);

/* --------------------------------- patch -------------------------------- */

galleryRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/galleries/{galleryId}',
    tags: ['Galleries'],
    summary: 'Edit a gallery',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: {
      params: z.object({ galleryId: Ulid }),
      body: { content: { 'application/json': { schema: PatchGalleryBody } }, required: true },
    },
    responses: { 200: ok(Gallery, 'The updated gallery.'), ...authErrors, 404: err('No such gallery.') },
  }),
  async (c) => {
    const { galleryId } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedGallery(c, galleryId);

    await c
      .get('db')
      .update(galleries)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
        ...(body.allowDownload !== undefined ? { allowDownload: body.allowDownload } : {}),
        ...(body.coverPhotoId !== undefined ? { coverPhotoId: body.coverPhotoId } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(galleries.id, galleryId));

    await audit(c, {
      action: 'gallery.updated',
      eventId: existing.eventId,
      targetType: 'gallery',
      targetId: galleryId,
    });

    const [row] = await c.get('db').select(galleryFields).from(galleries).where(eq(galleries.id, galleryId));
    return c.json(row!, 200);
  },
);

galleryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/galleries/{galleryId}',
    tags: ['Galleries'],
    summary: 'Delete a gallery',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { params: z.object({ galleryId: Ulid }) },
    responses: { 204: { description: 'Deleted.' }, ...authErrors, 404: err('No such gallery.') },
  }),
  async (c) => {
    const { galleryId } = c.req.valid('param');
    const existing = await loadOwnedGallery(c, galleryId);
    await c.get('db').delete(galleries).where(eq(galleries.id, galleryId));
    await audit(c, {
      action: 'gallery.deleted',
      eventId: existing.eventId,
      targetType: 'gallery',
      targetId: galleryId,
    });
    return c.body(null, 204);
  },
);

export { count };
