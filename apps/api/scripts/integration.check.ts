import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

// Runs against the configured Supabase project, creating isolated fixtures and
// removing only this run's users, events, objects, and audit rows in finally.
const port = Number(process.env.INTEGRATION_PORT ?? 8799);
const origin = `http://127.0.0.1:${port}`;
const worker = spawn('wrangler', ['dev', '--port', String(port), '--inspector-port', '0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let logs = '';
worker.stdout.on('data', (chunk) => {
  logs = (logs + chunk).slice(-6000);
});
worker.stderr.on('data', (chunk) => {
  logs = (logs + chunk).slice(-6000);
});
const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(process.env.SUPABASE_STORAGE_BUCKET!);
const userIds: string[] = [],
  eventIds: string[] = [],
  objectKeys: string[] = [];
const run = crypto.randomUUID();
const password = `Test!${crypto.randomUUID()}`;
let checks = 0;

class Actor {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, status = 200, csrf = true) {
    const headers: Record<string, string> = { Origin: origin, 'cf-connecting-ip': `integration-${run}` };
    if (this.cookies.size)
      headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (csrf && this.cookies.has('csrf'))
      headers['X-CSRF-Token'] = decodeURIComponent(this.cookies.get('csrf')!);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]!;
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    assert.equal(response.status, status, `${method} ${path}`);
    checks++;
    return response;
  }
  async json(path: string, method = 'GET', body?: unknown, status = 200) {
    return (await this.request(path, method, body, status)).json() as Promise<any>;
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (worker.exitCode !== null) throw new Error('Worker failed to start. ' + logs);
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await delay(200);
  }
  assert.ok(ready, 'Worker did not become ready');
  const lead = new Actor(),
    member = new Actor(),
    outsider = new Actor(),
    customer = new Actor(),
    anonymous = new Actor();
  await anonymous.request('/api/v1/events', 'GET', undefined, 401);
  await lead.request(
    '/api/v1/auth/register',
    'POST',
    { email: 'invalid', password: 'short', displayName: '' },
    422,
  );
  const leadEmail = `lead-${run}@example.test`;
  const leadMe = await lead.json(
    '/api/v1/auth/register',
    'POST',
    { email: leadEmail, password, displayName: 'Integration Lead' },
    201,
  );
  userIds.push(leadMe.user.id);
  await anonymous.request(
    '/api/v1/auth/login',
    'POST',
    { email: leadEmail, password: 'incorrect-password' },
    401,
  );
  const login = await lead.json('/api/v1/auth/login', 'POST', { email: leadEmail, password });
  assert.equal(login.user.id, leadMe.user.id);
  await lead.request('/api/v1/events', 'POST', { name: 'CSRF rejection' }, 403, false);
  const event = await lead.json('/api/v1/events', 'POST', { name: `Workflow ${run}` }, 201);
  eventIds.push(event.id);
  const added = await lead.json(
    `/api/v1/events/${event.id}/members`,
    'POST',
    { email: `member-${run}@example.test`, displayName: 'Integration Member', role: 'member' },
    201,
  );
  userIds.push(added.userId);
  const memberMe = await member.json('/api/v1/auth/login', 'POST', {
    email: added.email,
    password: added.temporaryPassword,
  });
  assert.equal(memberMe.user.isPlatformAdmin, false);
  assert.equal((await member.json('/api/v1/events')).data.length, 1);
  await member.request('/api/v1/events', 'POST', { name: 'Not permitted' }, 403);
  await member.request(
    `/api/v1/events/${event.id}/members`,
    'POST',
    { email: 'other@example.test', role: 'member' },
    403,
  );
  const outsiderMe = await outsider.json(
    '/api/v1/auth/register',
    'POST',
    { email: `outsider-${run}@example.test`, password, displayName: 'Other Lead' },
    201,
  );
  userIds.push(outsiderMe.user.id);
  const otherEvent = await outsider.json('/api/v1/events', 'POST', { name: 'Other event' }, 201);
  eventIds.push(otherEvent.id);
  await member.request(`/api/v1/events/${otherEvent.id}`, 'GET', undefined, 404);
  await outsider.request(`/api/v1/events/${event.id}/photos`, 'GET', undefined, 404);

  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lHcAAAAASUVORK5CYII=',
    'base64',
  );
  await member.request(
    `/api/v1/events/${event.id}/photos/upload-intent`,
    'POST',
    { files: [{ filename: 'script.svg', contentType: 'image/svg+xml', fileSize: 20 }] },
    422,
  );
  const intent = await member.json(`/api/v1/events/${event.id}/photos/upload-intent`, 'POST', {
    files: ['one.png', 'two.png', 'failed.png'].map((filename) => ({
      filename,
      contentType: 'image/png',
      fileSize: image.length,
    })),
  });
  assert.equal(intent.uploads.length, 3);
  objectKeys.push(...intent.uploads.map((upload: any) => upload.storageKey));
  const before = await member.json(`/api/v1/events/${event.id}/photos/confirm`, 'POST', {
    items: [{ photoId: intent.uploads[2].photoId }],
  });
  assert.equal(before.confirmed, 0);
  assert.deepEqual(before.missing, [intent.uploads[2].photoId]);
  for (const upload of intent.uploads.slice(0, 2)) {
    const result = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: image,
    });
    assert.ok(result.ok, `Storage upload failed: ${result.status}`);
    checks++;
  }
  const confirmed = await member.json(`/api/v1/events/${event.id}/photos/confirm`, 'POST', {
    items: intent.uploads.map((upload: any) => ({ photoId: upload.photoId, width: 1, height: 1 })),
  });
  assert.equal(confirmed.confirmed, 2);
  assert.deepEqual(confirmed.missing, [intent.uploads[2].photoId]);
  const retry = await member.json(`/api/v1/events/${event.id}/photos/confirm`, 'POST', {
    items: [{ photoId: intent.uploads[0].photoId }],
  });
  assert.equal(retry.confirmed, 1);
  const leadIntent = await lead.json(`/api/v1/events/${event.id}/photos/upload-intent`, 'POST', {
    files: [{ filename: 'lead.png', contentType: 'image/png', fileSize: image.length }],
  });
  const leadPhoto = leadIntent.uploads[0];
  objectKeys.push(leadPhoto.storageKey);
  assert.ok(
    (
      await fetch(leadPhoto.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: image,
      })
    ).ok,
  );
  await lead.json(`/api/v1/events/${event.id}/photos/confirm`, 'POST', {
    items: [{ photoId: leadPhoto.photoId, width: 1, height: 1 }],
  });
  assert.equal((await lead.json(`/api/v1/events/${event.id}/photos`)).data.length, 3);
  assert.equal((await member.json(`/api/v1/events/${event.id}/photos`)).data.length, 2);
  assert.equal(
    (await member.json(`/api/v1/events/${event.id}/photos?uploaderId=${leadMe.user.id}`)).data.length,
    0,
  );
  await member.request(`/img/full/${leadPhoto.storageKey}`, 'GET', undefined, 404);
  await anonymous.request(`/img/full/${leadPhoto.storageKey}`, 'GET', undefined, 401);
  await member.request(`/api/v1/photos/${leadPhoto.photoId}`, 'PATCH', { caption: 'Not mine' }, 403);
  await member.request(`/api/v1/photos/${leadPhoto.photoId}`, 'DELETE', undefined, 403);
  const bulkDelete = `/api/v1/events/${event.id}/photos/delete`;
  await anonymous.request(bulkDelete, 'POST', { photoIds: [leadPhoto.photoId] }, 401);
  await outsider.request(`/api/v1/photos/${leadPhoto.photoId}`, 'DELETE', undefined, 404);
  await outsider.request(bulkDelete, 'POST', { photoIds: [leadPhoto.photoId] }, 404);
  await lead.request(bulkDelete, 'POST', { photoIds: [] }, 422);
  await lead.request(bulkDelete, 'POST', { photoIds: Array(501).fill(leadPhoto.photoId) }, 422);
  await lead.request(bulkDelete, 'POST', { photoIds: [leadPhoto.photoId] }, 403, false);
  await member.request(bulkDelete, 'POST', { photoIds: [intent.uploads[0].photoId, leadPhoto.photoId] }, 403);
  assert.equal(
    (await lead.json(`/api/v1/events/${event.id}/photos`)).data.length,
    3,
    'Forbidden batch must not partially delete',
  );
  const foreign = await outsider.json(`/api/v1/events/${otherEvent.id}/photos/upload-intent`, 'POST', {
    files: [{ filename: 'foreign.png', contentType: 'image/png', fileSize: image.length }],
  });
  await lead.request(bulkDelete, 'POST', { photoIds: [leadPhoto.photoId, foreign.uploads[0].photoId] }, 404);
  assert.equal(
    (await lead.json(`/api/v1/events/${event.id}/photos`)).data.length,
    3,
    'Cross-event batch must not partially delete',
  );
  await db`update photos set created_at=${Date.now() - 16 * 60 * 1000} where id=${intent.uploads[2].photoId}`;
  await member.request(`/api/v1/photos/${intent.uploads[2].photoId}`, 'DELETE', undefined, 403);
  await member.request(
    bulkDelete,
    'POST',
    { photoIds: [intent.uploads[1].photoId, intent.uploads[2].photoId] },
    403,
  );
  assert.equal(
    (await member.json(`/api/v1/events/${event.id}/photos`)).data.length,
    2,
    'Expired-photo batch must not partially delete',
  );
  const selectedId = intent.uploads[0].photoId;
  await member.request(
    `/api/v1/events/${event.id}/photos/select`,
    'POST',
    { photoIds: [selectedId], selected: true },
    403,
  );
  await lead.request(`/api/v1/events/${event.id}/photos/select`, 'POST', {
    photoIds: [selectedId],
    selected: true,
  });
  await member.request(
    `/api/v1/events/${event.id}/galleries`,
    'POST',
    { title: 'Forbidden', useSelected: true, publish: true },
    403,
  );
  await lead.request(
    `/api/v1/events/${event.id}/galleries`,
    'POST',
    { title: 'Invalid PIN', useSelected: true, pin: '123' },
    422,
  );
  const created = await lead.json(
    `/api/v1/events/${event.id}/galleries`,
    'POST',
    { title: 'Integration gallery', useSelected: true, publish: false, pin: '482917', allowDownload: true },
    201,
  );
  assert.equal(created.pin, '482917');
  assert.equal(created.gallery.photoCount, 1);
  const base = `/api/v1/public/galleries/${created.gallery.slug}`;
  await customer.request(base, 'GET', undefined, 404);
  await member.request(`/api/v1/galleries/${created.gallery.id}/publish`, 'POST', undefined, 403);
  await lead.request(`/api/v1/galleries/${created.gallery.id}/publish`, 'POST');
  await customer.request(`${base}/photos`, 'GET', undefined, 401);
  await customer.request(`${base}/photos/${selectedId}/image/full`, 'GET', undefined, 401);
  await customer.request(`${base}/unlock`, 'POST', { pin: '000000' }, 401);
  await customer.request(`${base}/unlock`, 'POST', { pin: '482917' }, 204);
  assert.deepEqual(
    (await customer.json(`${base}/photos`)).data.map((photo: any) => photo.id),
    [selectedId],
  );
  const visible = await customer.request(`${base}/photos/${selectedId}/image/full`);
  assert.equal(Buffer.from(await visible.arrayBuffer()).equals(image), true);
  await customer.request(`${base}/photos/${intent.uploads[1].photoId}/image/full`, 'GET', undefined, 404);
  await lead.request(`/api/v1/events/${event.id}/photos/select`, 'POST', {
    photoIds: [selectedId],
    selected: false,
  });
  assert.equal(
    (await customer.json(`${base}/photos`)).data.length,
    1,
    'Published snapshot must remain stable',
  );
  const zip = await customer.request(`${base}/download-all`);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.ok((await zip.arrayBuffer()).byteLength > image.length);
  await customer.request(`${base}/lock`, 'POST', undefined, 204);
  await customer.request(`${base}/photos`, 'GET', undefined, 401);
  await customer.request(`${base}/unlock`, 'POST', { pin: '482917' }, 204);
  await lead.request(`/api/v1/galleries/${created.gallery.id}/unpublish`, 'POST');
  await customer.request(`${base}/photos`, 'GET', undefined, 404);
  await customer.request(`${base}/photos/${selectedId}/image/full`, 'GET', undefined, 404);
  await lead.request(`/api/v1/galleries/${created.gallery.id}/publish`, 'POST');
  await customer.request(`${base}/photos`, 'GET', undefined, 401);
  const rotated = await lead.json(`/api/v1/galleries/${created.gallery.id}/rotate-pin`, 'POST');
  await customer.request(`${base}/unlock`, 'POST', { pin: '482917' }, 401);
  await customer.request(`${base}/unlock`, 'POST', { pin: rotated.pin }, 204);
  // Single deletion by the uploader, including rejection of stale upload confirmations.
  await member.request(`/api/v1/photos/${intent.uploads[1].photoId}`, 'DELETE', undefined, 204);
  const reconfirm = await member.json(`/api/v1/events/${event.id}/photos/confirm`, 'POST', {
    items: [{ photoId: intent.uploads[1].photoId }],
  });
  assert.deepEqual(reconfirm.missing, [intent.uploads[1].photoId]);
  await lead.request(`/api/v1/photos/${intent.uploads[2].photoId}`, 'DELETE', undefined, 204);
  await db`update galleries set cover_photo_id=${selectedId} where id=${created.gallery.id}`;
  const removed = await lead.json(bulkDelete, 'POST', {
    photoIds: [selectedId, leadPhoto.photoId, selectedId],
  });
  assert.equal(removed.deleted, 2, 'Duplicate IDs should be deleted only once');
  assert.equal(
    (await lead.json(bulkDelete, 'POST', { photoIds: [selectedId, leadPhoto.photoId] })).deleted,
    0,
    'Retries are idempotent',
  );
  await lead.request(`/api/v1/photos/${leadPhoto.photoId}`, 'DELETE', undefined, 204);
  assert.equal((await lead.json(`/api/v1/events/${event.id}/photos`)).data.length, 0);
  assert.equal((await lead.json(`/api/v1/events/${event.id}/stats`)).readyPhotos, 0);
  assert.equal((await lead.json(`/api/v1/events/${event.id}/galleries`)).data[0].photoCount, 0);
  const teaser = await customer.json(base);
  assert.equal(teaser.photoCount, 0);
  assert.equal(teaser.coverThumbUrl, null);
  assert.equal((await customer.json(`${base}/photos`)).data.length, 0);
  await customer.request(`${base}/photos/${selectedId}/image/full`, 'GET', undefined, 404);
  await lead.request(`/img/full/${leadPhoto.storageKey}`, 'GET', undefined, 404);
  const emptyZip = await customer.request(`${base}/download-all`);
  assert.equal((await emptyZip.arrayBuffer()).byteLength, 22, 'Deleted photos must not appear in the ZIP');
  await lead.request(`/api/v1/events/${event.id}/members/${added.userId}`, 'DELETE', undefined, 204);
  await member.request(`/api/v1/events/${event.id}/photos`, 'GET', undefined, 404);
  await lead.request('/api/v1/auth/logout', 'POST', undefined, 204);
  await lead.request('/api/v1/events', 'GET', undefined, 401);
  console.log(
    `PASS: ${checks} HTTP checks plus workflow assertions (auth, roles, uploads, selection, publishing, PIN, images, downloads, revocation).`,
  );
} finally {
  try {
    if (objectKeys.length) {
      const { error } = await storage.remove(objectKeys);
      if (error) throw error;
    }
    if (eventIds.length) await db`delete from events where id in ${db(eventIds)}`;
    if (userIds.length) {
      await db`delete from audit_log where actor_id in ${db(userIds)}`;
      await db`delete from users where id in ${db(userIds)}`;
    }
    await db`delete from rate_limits where key like ${`%integration-${run}%`}`;
  } finally {
    await db.end({ timeout: 1 });
    if (worker.pid) {
      try {
        process.kill(-worker.pid, 'SIGTERM');
      } catch {
        /* already stopped */
      }
    }
  }
}
