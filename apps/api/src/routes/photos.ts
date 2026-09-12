import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  AppError,
  ConfirmUploadBody,
  PatchPhotoBody,
  Photo,
  PhotoListQuery,
  SelectPhotosBody,
  Ulid,
  UploadIntentBody,
  UploadIntentResponse,
  page,
} from '@photos/shared';
import { and, eq, gte, inArray, like, lte, ne, sql, type SQL } from 'drizzle-orm';
import { eventMembers, photos, users } from '../db/schema.js';
import { ulid } from '../lib/ids.js';
import { paginate } from '../lib/keyset.js';
import { authErrors, err, listErrors, ok } from '../lib/openapi.js';
import { photoSorts } from '../lib/sorts.js';
import { requireEventRole, sessionAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createSignedUpload, storageKeyFor } from '../services/storage.js';
import type { AppBindings } from '../types.js';

export const photoRoutes = new OpenAPIHono<AppBindings>();

/** An uploader may delete their own mistake, but only for a short while. */
const SELF_DELETE_WINDOW_MS = 15 * 60 * 1000;

/* ----------------------------- upload intent ---------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events/{eventId}/photos/upload-intent',
    tags: ['Photos'],
    summary: 'Reserve upload slots',
    description:
      'Validates the batch, reserves `pending` rows, and returns signed Supabase Storage PUT URLs. Bytes go ' +
      'straight to Supabase Storage and never pass through the API. Send the whole batch in one call, not one ' +
      'call per file. Files whose checksum already exists in this event come back under ' +
      '`duplicates` with no upload slot.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      body: { content: { 'application/json': { schema: UploadIntentBody } }, required: true },
    },
    responses: {
      200: ok(UploadIntentResponse, 'Upload slots, and any duplicates that were skipped.'),
      413: err('A file exceeds the 25 MB limit.'),
      415: err('Unsupported image type.'),
      422: err('The manifest failed validation.'),
      ...authErrors,
      404: err('No such event.'),
    },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { files } = c.req.valid('json');
    const s = c.get('session')!;
    const db = c.get('db');
    const now = Date.now();

    const checksums = files.map((f) => f.checksum).filter((v): v is string => Boolean(v));
    const existing = checksums.length
      ? await db
          .select({ id: photos.id, checksum: photos.checksum })
          .from(photos)
          .where(and(eq(photos.eventId, eventId), inArray(photos.checksum, checksums)))
      : [];
    const byChecksum = new Map(existing.map((r) => [r.checksum!, r.id]));

    const duplicates: { filename: string; existingPhotoId: string }[] = [];
    const fresh = files.filter((f) => {
      const dup = f.checksum ? byChecksum.get(f.checksum) : undefined;
      if (dup) {
        duplicates.push({ filename: f.filename, existingPhotoId: dup });
        return false;
      }
      return true;
    });

    const uploads = await Promise.all(
      fresh.map(async (f) => {
        const photoId = ulid(now);
        const storageKey = storageKeyFor(eventId, photoId, f.filename);
        const { url, expiresAt } = await createSignedUpload(c.env, storageKey);
        return {
          row: {
            id: photoId,
            eventId,
            uploadedBy: s.userId,
            filename: f.filename,
            filenameLower: f.filename.toLowerCase(),
            storageKey,
            contentType: f.contentType,
            fileSize: f.fileSize,
            checksum: f.checksum ?? null,
            status: 'pending' as const,
            createdAt: now,
            updatedAt: now,
          },
          out: { photoId, filename: f.filename, uploadUrl: url, storageKey, expiresAt },
        };
      }),
    );

    if (uploads.length) await db.insert(photos).values(uploads.map((u) => u.row));

    return c.json({ uploads: uploads.map((u) => u.out), duplicates }, 200);
  },
);

/* -------------------------------- confirm ------------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events/{eventId}/photos/confirm',
    tags: ['Photos'],
    summary: 'Confirm uploaded files',
    description:
      'Flips `pending` rows to `ready` and records dimensions and EXIF. Idempotent: a retried ' +
      'confirm after a flaky response changes nothing.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      body: { content: { 'application/json': { schema: ConfirmUploadBody } }, required: true },
    },
    responses: {
      200: ok(z.object({ confirmed: z.number().int(), missing: z.array(Ulid) }), 'What became ready.'),
      ...authErrors,
      404: err('No such event.'),
    },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { items } = c.req.valid('json');
    const s = c.get('session')!;
    const db = c.get('db');
    const now = Date.now();

    const missing: string[] = [];
    let confirmed = 0;

    for (const item of items) {
      const updated = await db
        .update(photos)
        .set({
          status: 'ready',
          width: item.width ?? null,
          height: item.height ?? null,
          takenAt: item.takenAt ?? null,
          dominantColor: item.dominantColor ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(photos.id, item.photoId),
            eq(photos.eventId, eventId),
            eq(photos.uploadedBy, s.userId),
            // Idempotent: confirming an already-ready photo is a no-op, not an error.
            eq(photos.status, 'pending'),
          ),
        )
        .returning({ id: photos.id });

      if (updated.length) confirmed++;
      else missing.push(item.photoId);
    }

    await audit(c, { action: 'photo.uploaded', eventId, metadata: { confirmed } });
    return c.json({ confirmed, missing }, 200);
  },
);

/* --------------------------------- list --------------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/events/{eventId}/photos',
    tags: ['Photos'],
    summary: 'List photos in an event',
    description:
      'Cursor-paginated. Pass `pageInfo.nextCursor` from the previous response as `cursor`. ' +
      'Cursors are signed and bound to the `sort` that minted them, so changing `sort` mid-walk ' +
      'returns 400 rather than a quietly wrong page. Filters compose into the keyset query without ' +
      'breaking the cursor.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('member')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      query: PhotoListQuery,
    },
    responses: { 200: ok(page(Photo), 'A page of photos.'), ...authErrors, ...listErrors, 404: err('No such event.') },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const q = c.req.valid('query');
    const db = c.get('db');

    const filters: (SQL | undefined)[] = [
      eq(photos.eventId, eventId),
      eq(photos.status, 'ready'),
      q.search ? like(photos.filenameLower, `%${q.search.toLowerCase()}%`) : undefined,
      q.uploaderId ? eq(photos.uploadedBy, q.uploaderId) : undefined,
      q.selected !== undefined ? eq(photos.isSelected, q.selected === 'true') : undefined,
      q.from !== undefined ? gte(photos.createdAt, q.from) : undefined,
      q.to !== undefined ? lte(photos.createdAt, q.to) : undefined,
    ];

    const result = await paginate({
      spec: photoSorts[q.sort],
      where: and(...filters),
      limit: q.limit,
      cursor: q.cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) =>
        db
          .select({
            id: photos.id,
            eventId: photos.eventId,
            uploadedBy: photos.uploadedBy,
            uploaderName: users.displayName,
            filename: photos.filename,
            filenameLower: photos.filenameLower,
            storageKey: photos.storageKey,
            contentType: photos.contentType,
            fileSize: photos.fileSize,
            width: photos.width,
            height: photos.height,
            dominantColor: photos.dominantColor,
            caption: photos.caption,
            takenAt: photos.takenAt,
            status: photos.status,
            isSelected: photos.isSelected,
            createdAt: photos.createdAt,
          })
          .from(photos)
          .innerJoin(users, eq(users.id, photos.uploadedBy))
          .where(where)
          .orderBy(...order)
          .limit(take),
    });

    return c.json(result, 200);
  },
);

/* ------------------------------ bulk select ----------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/events/{eventId}/photos/select',
    tags: ['Photos'],
    summary: 'Select or deselect photos in bulk',
    description: 'Curation is admin-only. Up to 500 ids per call.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth(), requireEventRole('admin')] as const,
    request: {
      params: z.object({ eventId: Ulid }),
      body: { content: { 'application/json': { schema: SelectPhotosBody } }, required: true },
    },
    responses: { 200: ok(z.object({ updated: z.number().int() }), 'How many changed.'), ...authErrors },
  }),
  async (c) => {
    const { eventId } = c.req.valid('param');
    const { photoIds, selected } = c.req.valid('json');

    const updated = await c
      .get('db')
      .update(photos)
      .set({ isSelected: selected, updatedAt: Date.now() })
      // The eventId predicate is what stops ids from another event being flipped.
      .where(and(eq(photos.eventId, eventId), inArray(photos.id, photoIds)))
      .returning({ id: photos.id });

    await audit(c, { action: selected ? 'photo.selected' : 'photo.deselected', eventId, metadata: { count: updated.length } });
    return c.json({ updated: updated.length }, 200);
  },
);

/* --------------------------------- patch -------------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/photos/{photoId}',
    tags: ['Photos'],
    summary: 'Edit one photo',
    description:
      'The event lead can caption and select. An uploader can caption their own photo but never ' +
      'select it, because selection is a publishing decision.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: {
      params: z.object({ photoId: Ulid }),
      body: { content: { 'application/json': { schema: PatchPhotoBody } }, required: true },
    },
    responses: { 200: ok(Photo, 'The updated photo.'), ...authErrors, 404: err('No such photo.') },
  }),
  async (c) => {
    const { photoId } = c.req.valid('param');
    const body = c.req.valid('json');
    const s = c.get('session')!;
    const db = c.get('db');

    const [row] = await db
      .select({
        photo: photos,
        role: eventMembers.role,
        uploaderName: users.displayName,
      })
      .from(photos)
      .innerJoin(users, eq(users.id, photos.uploadedBy))
      .leftJoin(
        eventMembers,
        and(eq(eventMembers.eventId, photos.eventId), eq(eventMembers.userId, s.userId)),
      )
      .where(eq(photos.id, photoId))
      .limit(1);

    // No membership row means this photo belongs to somebody else's event: 404,
    // because confirming it exists would leak.
    if (!row || !row.role) throw new AppError('NOT_FOUND', 'Photo not found.');

    const isOwner = row.photo.uploadedBy === s.userId;
    if (row.role !== 'admin' && !isOwner) {
      throw new AppError('FORBIDDEN', 'You can only edit photos you uploaded.');
    }
    if (body.isSelected !== undefined && row.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Only the event lead selects photos for a gallery.');
    }

    const [updated] = await db
      .update(photos)
      .set({
        ...(body.caption !== undefined ? { caption: body.caption } : {}),
        ...(body.isSelected !== undefined ? { isSelected: body.isSelected } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(photos.id, photoId))
      .returning();

    return c.json({ ...updated!, uploaderName: row.uploaderName }, 200);
  },
);

/* -------------------------------- delete -------------------------------- */

photoRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/photos/{photoId}',
    tags: ['Photos'],
    summary: 'Delete a photo',
    description:
      'Soft delete, restorable for 30 days. The event lead can delete anything; an uploader can ' +
      'delete their own upload within 15 minutes of uploading it.',
    security: [{ sessionAuth: [] }],
    middleware: [sessionAuth()] as const,
    request: { params: z.object({ photoId: Ulid }) },
    responses: { 204: { description: 'Deleted.' }, ...authErrors, 404: err('No such photo.') },
  }),
  async (c) => {
    const { photoId } = c.req.valid('param');
    const s = c.get('session')!;
    const db = c.get('db');

    const [row] = await db
      .select({ photo: photos, role: eventMembers.role })
      .from(photos)
      .leftJoin(
        eventMembers,
        and(eq(eventMembers.eventId, photos.eventId), eq(eventMembers.userId, s.userId)),
      )
      .where(eq(photos.id, photoId))
      .limit(1);

    if (!row || !row.role) throw new AppError('NOT_FOUND', 'Photo not found.');

    const isOwner = row.photo.uploadedBy === s.userId;
    const withinWindow = Date.now() - row.photo.createdAt < SELF_DELETE_WINDOW_MS;
    if (row.role !== 'admin' && !(isOwner && withinWindow)) {
      throw new AppError(
        'FORBIDDEN',
        isOwner
          ? 'You can only remove your own uploads within 15 minutes. Ask the event lead.'
          : 'Only the event lead can remove other people’s photos.',
      );
    }

    const now = Date.now();
    await db
      .update(photos)
      .set({ status: 'deleted', deletedAt: now, isSelected: false, updatedAt: now })
      .where(eq(photos.id, photoId));
    await audit(c, { action: 'photo.deleted', eventId: row.photo.eventId, targetType: 'photo', targetId: photoId });

    return c.body(null, 204);
  },
);

export { ne };
