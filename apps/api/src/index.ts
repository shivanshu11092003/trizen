import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { AppError } from '@photos/shared';
import { secureHeaders } from 'hono/secure-headers';
import { onError, zodDetails } from './lib/http.js';
import { ulid } from './lib/ids.js';
import { csrfGuard } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { galleryRoutes } from './routes/galleries.js';
import { mediaRoutes } from './routes/media.js';
import { photoRoutes } from './routes/photos.js';
import { publicRoutes } from './routes/public.js';
import { systemRoutes } from './routes/system.js';
import { reapOrphanUploads } from './services/reaper.js';
import { sweepExpiredSessions } from './services/sessions.js';
import { databaseFor } from './services/database.js';
import type { AppBindings } from './types.js';

const app = new OpenAPIHono<AppBindings>({
  // One shape for every validation failure, wherever it happens.
  defaultHook: (result, c) => {
    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', 'Some fields need attention.', {
        details: zodDetails(result.error),
      });
    }
  },
});

app.onError(onError);

app.use('*', async (c, next) => {
  c.set('requestId', c.req.header('cf-ray') ?? ulid());
  c.set('db', databaseFor(c.env));
  await next();
  c.header('X-Request-Id', c.get('requestId'));
});

app.use(
  '*',
  secureHeaders({
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    xFrameOptions: 'DENY',
    crossOriginResourcePolicy: 'same-origin',
  }),
);

app.use('/api/*', csrfGuard());

const api = new OpenAPIHono<AppBindings>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', 'Some fields need attention.', {
        details: zodDetails(result.error),
      });
    }
  },
});

api.route('/', authRoutes);
api.route('/', eventRoutes);
api.route('/', photoRoutes);
api.route('/', galleryRoutes);
api.route('/', publicRoutes);

app.route('/api/v1', api);
app.route('/', systemRoutes);
app.route('/', mediaRoutes);

/* ----------------------------- OpenAPI docs ----------------------------- */

api.openAPIRegistry.registerComponent('securitySchemes', 'sessionAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: '__Host-sid',
  description:
    'Set by POST /auth/login. httpOnly, so JavaScript cannot read it. Non-GET requests must also ' +
    'echo the readable `csrf` cookie in an `X-CSRF-Token` header.',
});

api.openAPIRegistry.registerComponent('securitySchemes', 'galleryAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'gsid_{slug}',
  description:
    'Set by POST /public/galleries/{slug}/unlock. Path-scoped to its own gallery, so the browser ' +
    'never transmits it to a different gallery.',
});

const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Photo Sharing Platform API',
    version: '1.0.0',
    description: [
      'A photography team uploads to an event, the lead curates a selection, and the client opens a',
      'PIN-protected gallery with no account.',
      '',
      '## Authentication',
      '',
      'Server-side sessions, not JWTs. `POST /auth/login` sets an httpOnly cookie; every request',
      'after that carries it automatically. Revoking a session or removing a team member takes',
      'effect on the **next request**, which is the whole reason for the choice.',
      '',
      'Non-GET requests must echo the readable `csrf` cookie in an `X-CSRF-Token` header.',
      '',
      '## How to paginate',
      '',
      'Every list endpoint is cursor-based. There are no page numbers and no `offset`, because rows',
      'shift under concurrent uploads and offset pagination would silently duplicate and skip photos.',
      '',
      'Send `limit`, read `pageInfo.nextCursor`, send it back as `cursor`, and stop when',
      '`hasNextPage` is false:',
      '',
      '```bash',
      'cursor=""',
      'while :; do',
      '  page=$(curl -s -b cookies.txt \\',
      '    "$API/events/$EVENT/photos?limit=100&sort=newest${cursor:+&cursor=$cursor}")',
      '  echo "$page" | jq -r \'.data[].filename\'',
      '  [ "$(echo "$page" | jq -r .pageInfo.hasNextPage)" = "true" ] || break',
      '  cursor=$(echo "$page" | jq -r .pageInfo.nextCursor)',
      'done',
      '```',
      '',
      'Cursors are HMAC-signed and bound to the `sort` that minted them. Changing `sort` mid-walk',
      'returns `400 INVALID_CURSOR` rather than a quietly wrong page.',
    ].join('\n'),
  },
  tags: [
    { name: 'Auth', description: 'Sessions for the photography team.' },
    { name: 'Events', description: 'Shoots. Membership here is the authorization spine.' },
    { name: 'Members', description: 'Who is on an event, and what they may do.' },
    { name: 'Photos', description: 'Upload, browse, curate. Every list is cursor-paginated.' },
    { name: 'Galleries', description: 'Curate a selection and publish it behind a PIN.' },
    { name: 'Public Gallery', description: 'What the customer touches. No account required.' },
    { name: 'Media', description: 'Image delivery and derivatives.' },
    { name: 'System', description: 'Health and machine-readable docs.' },
  ],
  'x-tagGroups': [
    { name: 'Team API', tags: ['Auth', 'Events', 'Members', 'Photos', 'Galleries'] },
    { name: 'Customer API', tags: ['Public Gallery'] },
    { name: 'Infrastructure', tags: ['Media', 'System'] },
  ],
};

api.doc31('/openapi.json', openApiDoc);
app.doc31('/openapi.json', openApiDoc);

const docsEnabled = (c: { env: { DOCS_ENABLED?: string } }) => c.env.DOCS_ENABLED !== 'false';

app.get('/docs', async (c) => {
  if (!docsEnabled(c)) return c.notFound();
  const response = await swaggerUI({
    url: '/api/v1/openapi.json',
    // The session cookie is same-origin, so try-it-out works after a normal
    // login. Non-GET calls still need the double-submit header.
    requestInterceptor: `(req) => {
      const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/);
      if (m && req.method !== 'GET' && req.method !== 'HEAD') req.headers['X-CSRF-Token'] = decodeURIComponent(m[1]);
      req.credentials = 'same-origin';
      return req;
    }`,
  })(c as never, async () => {});
  return response ?? c.notFound();
});

app.get('/redoc', (c) => {
  if (!docsEnabled(c)) return c.notFound();
  return c.html(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Photo Sharing Platform API</title>
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.5.0/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
});

export default {
  fetch: app.fetch,

  /** Cron: sweep expired sessions and reap uploads that never completed. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = databaseFor(env);
    ctx.waitUntil(
      (async () => {
        await sweepExpiredSessions(db);
        await reapOrphanUploads(db, env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };

type Env = AppBindings['Bindings'];
