import { apiRouter } from '../lib/openapi.js';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  AppError,
  GalleryTeaser,
  PaginationQuery,
  Photo,
  UnlockBody,
  page,
  prefetch,
} from '@photos/shared';
import { makeZip } from 'client-zip';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { galleries, galleryPhotos, gallerySessions, photos, pinAttempts } from '../db/schema.js';
import {
  clearGalleryCookie,
  readGalleryCookie,
  setGalleryCookie,
} from '../lib/cookies.js';
import { verifySecret } from '../lib/crypto.js';
import { ulid } from '../lib/ids.js';
import { paginate } from '../lib/keyset.js';
import { err, gallerySecurity, listErrors, ok } from '../lib/openapi.js';
import { gallerySorts } from '../lib/sorts.js';
import { createGallerySession, resolveGallerySession } from '../services/sessions.js';
import { getStorageObject } from '../services/storage.js';
import type { AppBindings } from '../types.js';

export const publicRoutes = apiRouter();
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_FAILURE_LIMIT = 5;

type PublicGallery = {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'unpublished';
  pinHash: string;
  expiresAt: number | null;
  allowDownload: boolean;
  coverPhotoId: string | null;
};

async function loadPublicGallery(c: Parameters<typeof resolveGallerySession>[0], slug: string): Promise<PublicGallery> {
  const [gallery] = await c
    .get('db')
    .select({
      id: galleries.id,
      slug: galleries.slug,
      title: galleries.title,
      status: galleries.status,
      pinHash: galleries.pinHash,
      expiresAt: galleries.expiresAt,
      allowDownload: galleries.allowDownload,
      coverPhotoId: galleries.coverPhotoId,
    })
    .from(galleries)
    .where(eq(galleries.slug, slug))
    .limit(1);

  if (!gallery || gallery.status !== 'published') {
    // Draft, unpublished, and unknown deliberately have the same shape.
    throw new AppError('GALLERY_NOT_PUBLISHED', 'Gallery not found.');
  }
  if (gallery.expiresAt !== null && gallery.expiresAt <= Date.now()) {
    throw new AppError('GALLERY_EXPIRED', 'This gallery has expired. Ask your photographer for a new link.');
  }
  return gallery;
}

export const galleryAuth = () =>
  createMiddleware<AppBindings>(async (c, next) => {
    const slug = c.req.param('slug');
    if (!slug) throw new AppError('NOT_FOUND', 'Gallery not found.');
    const gallery = await loadPublicGallery(c, slug);
    const token = readGalleryCookie(c, slug);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Enter the gallery PIN to continue.');
    const session = await resolveGallerySession(c, token, gallery.id);
    if (!session) throw new AppError('UNAUTHENTICATED', 'This gallery session has ended. Enter the PIN again.');
    c.set('gallery', {
      gallerySessionId: session.id,
      galleryId: gallery.id,
      slug,
      allowDownload: gallery.allowDownload,
    });
    await next();
  });

publicRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/public/galleries/{slug}',
    tags: ['Public Gallery'],
    summary: 'Preview a private gallery',
    description: 'Returns display-safe metadata only. Draft and unknown slugs are indistinguishable.',
    request: { params: z.object({ slug: z.string().min(16).max(100) }) },
    responses: {
      200: ok(GalleryTeaser, 'Safe metadata for the PIN screen.'),
      404: err('Unknown, draft, or unpublished. These intentionally look identical.'),
      410: err('The gallery expired.'),
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param');
    const gallery = await loadPublicGallery(c, slug);
    const [total] = await c
      .get('db')
      .select({ value: count() })
      .from(galleryPhotos)
      .innerJoin(photos, eq(photos.id, galleryPhotos.photoId))
      .where(and(eq(galleryPhotos.galleryId, gallery.id), eq(photos.status, 'ready')));
    const token = readGalleryCookie(c, slug);
    const unlocked = token ? Boolean(await resolveGallerySession(c, token, gallery.id)) : false;
    return c.json({
      title: gallery.title,
      photoCount: total?.value ?? 0,
      coverThumbUrl: gallery.coverPhotoId
        ? `/api/v1/public/galleries/${slug}/photos/${gallery.coverPhotoId}/image/thumb`
        : null,
      allowDownload: gallery.allowDownload,
      expiresAt: gallery.expiresAt,
      unlocked,
    }, 200);
  },
);

publicRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/public/galleries/{slug}/unlock',
    tags: ['Public Gallery'],
    summary: 'Unlock with the client PIN',
    description: 'Five failed attempts in 15 minutes are allowed; the sixth is rate-limited.',
    request: {
      params: z.object({ slug: z.string().min(16).max(100) }),
      body: { content: { 'application/json': { schema: UnlockBody } }, required: true },
    },
    responses: {
      204: { description: 'Unlocked. A gallery-specific, path-scoped cookie was set.' },
      401: err('The PIN was wrong.'),
      404: err('Unknown, draft, or unpublished.'),
      410: err('The gallery expired.'),
      429: err('Too many attempts. Includes Retry-After.'),
      422: err('The PIN is not six digits.'),
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param');
    const { pin } = c.req.valid('json');
    const gallery = await loadPublicGallery(c, slug);
    const now = Date.now();
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    const ipHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}:${c.env.IP_HASH_PEPPER}`))
      .then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));

    const [failures] = await c
      .get('db')
      .select({ value: count() })
      .from(pinAttempts)
      .where(and(
        eq(pinAttempts.galleryId, gallery.id),
        eq(pinAttempts.ipHash, ipHash),
        eq(pinAttempts.success, false),
        gt(pinAttempts.attemptedAt, now - PIN_WINDOW_MS),
      ));
    if ((failures?.value ?? 0) >= PIN_FAILURE_LIMIT) {
      throw new AppError('PIN_LOCKED', 'Too many attempts. Try again in 15 minutes.', {
        headers: { 'Retry-After': '900' },
      });
    }

    const valid = await verifySecret(pin, gallery.pinHash, c.env.PIN_PEPPER);
    await c.get('db').insert(pinAttempts).values({
      id: ulid(now),
      galleryId: gallery.id,
      ipHash,
      success: valid,
      attemptedAt: now,
    });
    if (!valid) {
      const left = PIN_FAILURE_LIMIT - (failures?.value ?? 0) - 1;
      throw new AppError('PIN_INVALID', `That PIN doesn't match. ${left} attempt${left === 1 ? '' : 's'} left.`);
    }

    const session = await createGallerySession(c, gallery.id);
    setGalleryCookie(c, slug, session.token, session.maxAge);
    await c.get('db').update(galleries).set({
      viewCount: sql`${galleries.viewCount} + 1`,
      lastViewedAt: now,
    }).where(eq(galleries.id, gallery.id));
    return c.body(null, 204);
  },
);

publicRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/public/galleries/{slug}/photos',
    tags: ['Public Gallery'],
    summary: 'Browse the published snapshot',
    security: gallerySecurity,
    middleware: [galleryAuth()] as const,
    request: { params: z.object({ slug: z.string() }), query: PaginationQuery },
    responses: { 200: ok(page(Photo), 'A curated page.'), 401: err('Enter the PIN again.'), 410: err('Expired.'), ...listErrors },
  }),
  async (c) => {
    const { limit, cursor } = c.req.valid('query');
    const gallery = c.get('gallery')!;
    const result = await paginate({
      spec: gallerySorts.curated,
      where: and(eq(galleryPhotos.galleryId, gallery.galleryId), eq(photos.status, 'ready')),
      limit,
      cursor,
      secret: c.env.CURSOR_SECRET,
      select: (where, order, take) => c.get('db').select({
        photoId: galleryPhotos.photoId,
        sortOrder: galleryPhotos.sortOrder,
        id: photos.id,
        eventId: photos.eventId,
        uploadedBy: photos.uploadedBy,
        filename: photos.filename,
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
      }).from(galleryPhotos).innerJoin(photos, eq(photos.id, galleryPhotos.photoId)).where(where).orderBy(...order).limit(take),
    });
    return c.json(result, 200);
  },
);

publicRoutes.get('/public/galleries/:slug/photos/:photoId/image/:variant', galleryAuth(), async (c) => {
  const gallery = c.get('gallery')!;
  const variant = c.req.param('variant');
  if (!['thumb', 'preview', 'full'].includes(variant)) throw new AppError('NOT_FOUND', 'Image variant not found.');
  const download = c.req.query('download') === '1';
  if (download && !gallery.allowDownload) throw new AppError('DOWNLOAD_DISABLED', 'Downloads are disabled for this gallery.');
  const [photo] = await c.get('db').select({ key: photos.storageKey, type: photos.contentType, filename: photos.filename })
    .from(galleryPhotos)
    .innerJoin(photos, eq(photos.id, galleryPhotos.photoId))
    .where(and(eq(galleryPhotos.galleryId, gallery.galleryId), eq(photos.id, c.req.param('photoId')), eq(photos.status, 'ready')))
    .limit(1);
  if (!photo) throw new AppError('NOT_FOUND', 'Photo not found.');
  const object = await getStorageObject(c.env, photo.key, variant as 'thumb' | 'preview' | 'full');
  if (!object?.body) throw new AppError('NOT_FOUND', 'Photo not found.');
  return new Response(object.body, { headers: { 'Content-Type': object.headers.get('content-type') ?? photo.type, 'Cache-Control': 'private, max-age=3600',
    ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(photo.filename)}` } : {}),
  } });
});

publicRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/public/galleries/{slug}/lock',
    tags: ['Public Gallery'],
    summary: 'Lock this gallery',
    security: gallerySecurity,
    middleware: [galleryAuth()] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: { 204: { description: 'This gallery session ended.' }, 401: err('Not unlocked.') },
  }),
  async (c) => {
    await c.get('db').delete(gallerySessions).where(eq(gallerySessions.id, c.get('gallery')!.gallerySessionId));
    clearGalleryCookie(c, c.req.valid('param').slug);
    return c.body(null, 204);
  },
);

publicRoutes.on(['GET', 'POST'], '/public/galleries/:slug/download-all', galleryAuth(), async (c) => {
  const principal = c.get('gallery')!;
  if (!principal.allowDownload) throw new AppError('DOWNLOAD_DISABLED', 'Downloads are disabled for this gallery.');
  const rows = await c.get('db').select({
    key: photos.storageKey,
    filename: photos.filename,
    createdAt: photos.createdAt,
    photoId: galleryPhotos.photoId,
    sortOrder: galleryPhotos.sortOrder,
  }).from(galleryPhotos).innerJoin(photos, eq(photos.id, galleryPhotos.photoId))
    .where(and(eq(galleryPhotos.galleryId, principal.galleryId), eq(photos.status, 'ready')))
    .orderBy(galleryPhotos.sortOrder, galleryPhotos.photoId);

  async function* entries() {
    for await (const entry of prefetch(rows, 4, async (photo) => {
      const object = await getStorageObject(c.env, photo.key);
      if (!object?.body) return null;
      const safe = photo.filename.replace(/[/\\]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'photo';
      return { name: `${photo.photoId.slice(-6)}-${safe}`, input: object.body, lastModified: new Date(photo.createdAt) };
    })) if (entry) yield entry;
  }
  return new Response(makeZip(entries()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="gallery.zip"',
      'Cache-Control': 'no-store',
    },
  });
});
