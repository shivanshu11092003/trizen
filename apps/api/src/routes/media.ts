import { apiRouter } from '../lib/openapi.js';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '@photos/shared';
import { and, eq, or } from 'drizzle-orm';
import { eventMembers, photos } from '../db/schema.js';
import { readSessionCookie } from '../lib/cookies.js';
import { resolveSession } from '../services/sessions.js';
import { getStorageObject } from '../services/storage.js';
import type { AppBindings } from '../types.js';

export const mediaRoutes = apiRouter();

mediaRoutes.get('/img/:variant/*', async (c) => {
  const variant = c.req.param('variant');
  if (!['thumb', 'preview', 'full'].includes(variant)) throw new AppError('NOT_FOUND', 'Image variant not found.');
  const storageKey = c.req.path.split(`/img/${variant}/`)[1];
  if (!storageKey) throw new AppError('NOT_FOUND', 'Photo not found.');

  const token = readSessionCookie(c);
  const session = token ? await resolveSession(c, token) : null;
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to view this photograph.');

  const [allowed] = await c.get('db').select({ contentType: photos.contentType })
    .from(photos)
    .innerJoin(eventMembers, and(eq(eventMembers.eventId, photos.eventId), eq(eventMembers.userId, session.userId)))
    .where(and(eq(photos.storageKey, storageKey), eq(photos.status, 'ready'),
      or(eq(eventMembers.role, 'admin'), eq(photos.uploadedBy, session.userId))))
    .limit(1);
  if (!allowed) throw new AppError('NOT_FOUND', 'Photo not found.');

  const object = await getStorageObject(c.env, storageKey, variant as 'thumb' | 'preview' | 'full');
  if (!object?.body) throw new AppError('NOT_FOUND', 'Photo not found.');
  return new Response(object.body, {
    headers: {
      'Content-Type': object.headers.get('content-type') ?? allowed.contentType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
    },
  });
});
