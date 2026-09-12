import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { ok } from '../lib/openapi.js';
import { storageReady } from '../services/storage.js';
import type { AppBindings } from '../types.js';

export const systemRoutes = new OpenAPIHono<AppBindings>();

systemRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Liveness',
    description: 'The Worker is running. Says nothing about its dependencies.',
    responses: { 200: ok(z.object({ status: z.literal('ok') }), 'Alive.') },
  }),
  (c) => c.json({ status: 'ok' as const }),
);

systemRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/ready',
    tags: ['System'],
    summary: 'Readiness',
    description: 'Supabase Postgres and Storage are both reachable. This is the one to point a monitor at.',
    responses: {
      200: ok(z.object({ status: z.literal('ready'), db: z.boolean(), bucket: z.boolean() }), 'Ready.'),
      503: ok(z.object({ status: z.literal('degraded'), db: z.boolean(), bucket: z.boolean() }), 'Not ready.'),
    },
  }),
  async (c) => {
    const [db, bucket] = await Promise.all([
      c.get('db').execute(sql`SELECT 1`).then(() => true).catch(() => false),
      storageReady(c.env).catch(() => false),
    ]);
    if (db && bucket) return c.json({ status: 'ready' as const, db, bucket }, 200);
    return c.json({ status: 'degraded' as const, db, bucket }, 503);
  },
);
