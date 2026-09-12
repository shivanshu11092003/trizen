# BUILD PROMPT — Photo Sharing Platform (Trizen AI Full-Stack Internship)

> Paste this whole file as the opening instruction to your coding agent. It is the
> single source of truth for scope, stack, contracts, and acceptance.

---

## 0. Mission

Build, test, and deploy a production-quality **photo-sharing platform for event
photography teams**.

A photography team uploads shots for an event. The Admin/Lead reviews everything,
curates a selection, publishes it as a gallery, and hands the client a link plus a
PIN. The client opens the link, types the PIN, and browses their photos — no
account, no signup, no friction.

Ship **all core requirements first**, then **every bonus feature** listed in §9.
Do not sacrifice core functionality for bonus features. Deadline: **20 Sep 2026,
23:59 IST**. Submission goes to `talent@trizen-ai.com`.

**Non-negotiable engineering rules**

1. Every list endpoint that can return more than ~50 rows uses **cursor-based
   (keyset) pagination**. No `OFFSET`. No page numbers. Ever.
2. Image bytes never touch the database. Only metadata rows.
3. No secrets in Git. `.dev.vars`, `.env*`, and `wrangler.toml` secret blocks are
   gitignored; production secrets live in Cloudflare secret storage.
4. Every mutating endpoint validates input with Zod before touching the DB.
5. Authorization is enforced **server-side on every request**, never by hiding UI.
6. You must be able to explain every line you ship. No unexplained magic.

---

## 1. Technology Stack (fixed — do not substitute)

### Backend

| Concern | Choice |
|---|---|
| Runtime | **Cloudflare Workers** with `nodejs_compat` (Node.js/pnpm toolchain, Node APIs available in-worker) |
| Framework | **Hono** (TypeScript, typed bindings via `Hono<{ Bindings: Env }>`) |
| Database | **Cloudflare D1** (SQLite at the edge) |
| ORM / query layer | **Drizzle ORM** (`drizzle-orm/d1`) + `drizzle-kit` migrations |
| Object storage | **Cloudflare R2** (S3-compatible), presigned `PUT` uploads |
| Validation | **Zod** + `@hono/zod-validator` |
| API spec | **`@hono/zod-openapi`** — routes declare their Zod schemas once and emit OpenAPI 3.1 |
| API docs | **Swagger UI** (`@hono/swagger-ui`) at `/docs` + **Redoc** at `/redoc`, both served by the Worker |
| Auth | **Server-side sessions** — opaque 256-bit token in an httpOnly cookie, session record in D1. No JWTs. |
| CSRF | Double-submit token + `Origin` / `Sec-Fetch-Site` checks on every state-changing request |
| Password hashing | **PBKDF2-SHA-256** via WebCrypto (210 000 iterations, 16-byte salt) |
| Image transforms | Cloudflare Image Resizing via a Worker `/img` route (thumbnail/preview/full) |
| Rate limiting | D1-backed fixed-window counters + Cloudflare Rate Limiting rules |
| Logs | Workers Logpush / `wrangler tail`, structured JSON lines |

Why Workers + D1: one deploy target, zero cold-start cost on the free tier, R2 and
D1 bound directly into the runtime with no connection pooling or network hop, and
the whole thing sits behind Cloudflare's CDN for free. Document this trade-off in
the README, including D1's limits (no `RETURNING` on some paths, 100 MB DB, single
writer) and how you designed around them.

### Frontend

| Concern | Choice |
|---|---|
| Framework | **React 19** + **Vite** + **TypeScript (strict)** |
| Routing | **TanStack Router** (file-based, fully typed params/search, route-level `beforeLoad` auth guards) |
| Server state | **TanStack Query v5** — `useInfiniteQuery` for every cursor list |
| API client | **`@hey-api/openapi-ts`** — typed SDK, Zod schemas, and TanStack Query hooks generated from `/openapi.json`. No hand-written fetch wrappers. |
| Client state | **Zustand** — auth (session-derived, never persisted), theme (persisted), upload tray, selection |
| Virtualization | **TanStack Virtual** (grids of 1 000+ photos must stay at 60 fps) |
| Forms | **TanStack Form** + Zod resolvers |
| **Admin UI kit** | **Ant Design v5** — `Table`, `Popover`, `Drawer`, `Descriptions`, `Tag`, `Upload`, `Modal`, `Segmented`, `Tooltip`, `notification` |
| **Customer UI kit** | **shadcn/ui** (Radix primitives, copied into the repo and owned) |
| Styling | **Tailwind CSS v4** (`@theme` tokens) — the shared token layer under both kits |
| Icons | `lucide-react` throughout; `@ant-design/icons` only inside antd components that expect them |
| Hosting | **Cloudflare Pages** (SPA, `_redirects` fallback to `/index.html`) |

**Two kits, one product — deliberate, and you must defend it.** The admin tool is
a dense internal instrument: antd hands you sortable/filterable tables, row
selection, popovers, and drawers that would take a week to rebuild, and nobody
outside the team ever sees it. The customer gallery is the thing the client's
guests screenshot, so it gets shadcn/ui — unstyled Radix primitives you restyle
completely, with no framework fingerprint and no 1 MB CSS payload on a page whose
only job is showing photographs.

Cost of this choice, and how you pay it:

- **Route-split the bundles.** `/events/*` (antd) and `/gallery/*` (shadcn) are
  separate TanStack Router trees, both lazy. Antd must never appear in the public
  gallery chunk — assert it in CI with a bundle-size check that fails the build if
  `antd` shows up in the gallery entry graph.
- **No CSS reset collision.** Tailwind v4 ships no global preflight by default;
  keep it that way and let antd's `ConfigProvider` reset scope itself. Enable
  antd's `cssVar: true` + `hashed: false` so its tokens become CSS variables you
  can feed from the same `@theme` palette the gallery uses.
- **One source of truth for design tokens.** Brand colors, radii, and the type
  scale live in Tailwind `@theme`; antd's `ConfigProvider theme.token` reads those
  same values. The two halves must look like siblings, not strangers.
- **TanStack Table is dropped.** Antd `Table` covers the admin roster, upload
  manifest, and audit log with less code. Keep **TanStack Virtual** — the photo
  grid is not a table and antd has nothing for it.

### Shared

- **pnpm workspace monorepo**: `apps/api`, `apps/web`, `packages/shared`,
  `packages/api-client`.
- `packages/shared` holds what both sides genuinely share and cannot generate:
  the cursor codec, the async primitives, error codes, and the domain Zod
  schemas the API validates with.
- `packages/api-client` is **generated, never written**. The chain is one
  direction with no manual step in it:

  ```
  Zod schema  →  @hono/zod-openapi  →  /openapi.json  →  @hey-api/openapi-ts  →  typed SDK
   (validates)      (documents)          (contract)          (generates)          + TanStack Query hooks
                                                                                  + response Zod schemas
  ```

  One definition, four consumers, and drift is structurally impossible rather
  than merely discouraged. If the frontend calls an endpoint that doesn't exist,
  or passes a field the API doesn't accept, it fails at `tsc`, not in the demo.

### Testing / CI

- **Vitest** + `@cloudflare/vitest-pool-workers` — unit + integration tests run
  against a real in-process D1 with real migrations.
- **Playwright** — E2E of the five critical flows.
- **GitHub Actions** — typecheck → lint → test → build → `wrangler deploy` +
  Pages deploy on `main`; preview deploy on PRs.

---

## 2. Domain Model & Roles

### Roles

| Role | Capabilities |
|---|---|
| `admin` | Register/login. Create events. Add/remove team members. See **all** photos in own events. Select photos. Create, publish, unpublish, expire galleries. Set/rotate PIN. View audit log. |
| `member` | Login. See only assigned events. Upload photos. See own uploads (and, if event setting allows, teammates' uploads read-only). **Cannot** publish, cannot mutate others' photos, cannot manage membership. |
| `customer` | No account. Holds link + PIN. Opens gallery, enters PIN, browses + downloads published photos. Nothing else. |

Roles are **per-event membership**, not a global user column, plus a global
`is_platform_admin` flag for the account that can create new events. Model it as
`event_members(event_id, user_id, role)` — this is what makes "user attempts to
access another event" a one-line join check instead of a special case.

### Workflow (must work end to end)

1. Admin registers → creates event `Arjun & Priya Wedding`.
2. Admin invites team members (email + generated one-time invite token, or direct
   create with a temp password — document which and why).
3. Members upload photos (multi-select, drag-drop, folder drop, resumable-ish
   retry).
4. Admin reviews all 1 250 uploads in a virtualized grid, filters/searches, and
   selects 600.
5. Admin publishes → server mints `slug` (URL-safe, unguessable, ≥16 chars of
   entropy) + 6-digit PIN, returns them **once**.
6. Customer opens `/gallery/:slug`, enters PIN, browses, downloads.

### Session authentication (both audiences)

Auth is **stateful and cookie-based**. There are no JWTs anywhere in this system,
for the team app or the gallery.

The reasoning, which you must be able to give in the interview: a JWT's only real
advantage is that it can be verified without touching the database. Every
authenticated request here already reads D1 — to resolve `event_members`, to load
photos — so statelessness buys nothing and costs the thing that matters most in a
product holding other people's photographs: **instant, certain revocation**. When
an admin removes a team member, that member's access ends on their next request,
not up to fifteen minutes later. When a client forwards a gallery link to someone
they shouldn't have, the photographer revokes that session and it is gone. A
15-minute access token cannot promise either.

You also stop having to solve the problems JWTs create — refresh rotation, reuse
detection, revocation lists, where to store the access token so XSS can't reach
it. An opaque cookie the JavaScript can't read has none of those.

**Deploy on one origin.** The Worker takes `example.com/api/*`, `/img/*`, `/docs`,
`/redoc`; Pages serves the SPA at `example.com/*`. Cookies are then first-party,
`SameSite=Strict` works, and there is no CORS configuration to get wrong. Do not
split the API onto `api.example.com` — you would be forced down to `SameSite=Lax`
with a `Domain=` cookie for no benefit. Document this in the README as a
deliberate deployment decision.

**Team sessions** (`admin` / `member`)

- On login: generate 32 bytes from `crypto.getRandomValues`, base64url it. Store
  **only** `sha256(token)` in `sessions`. The raw value exists in the response
  cookie and nowhere else — a leaked database backup grants nobody a session.
- Cookie: `__Host-sid`, `HttpOnly; Secure; SameSite=Strict; Path=/`. The
  `__Host-` prefix is enforced by the browser: no `Domain` attribute, `Path=/`,
  `Secure` required — a subdomain that gets compromised cannot set it.
- **Sliding idle expiry of 7 days, absolute expiry of 30 days.** Refresh
  `last_seen_at` at most once every 5 minutes, so an active session doesn't write
  to D1 on every request.
- **Rotate the session id on login and on any privilege change**, carrying the
  record forward. This closes session fixation.
- Store `user_agent_hash` and `ip_hash` at creation. A mismatch is logged and
  surfaced to the user in the session list, but does **not** auto-revoke — mobile
  networks change IPs constantly and false logouts are worse than the risk here.
  Say this in the README; it is exactly the kind of judgment call a reviewer
  looks for.
- `GET /auth/sessions` lists a user's active sessions (device, location hint,
  last seen, "this device"), `DELETE /auth/sessions/:id` ends one, and
  `POST /auth/sessions/revoke-all` ends every session but the current one.
- Logout deletes the row. Not a flag, not a denylist — the row.

**Gallery sessions** (the customer, no account)

- A correct PIN creates a row in `gallery_sessions` and sets a cookie **scoped by
  path**: `Path=/api/v1/public/galleries/<slug>`, `HttpOnly; Secure;
  SameSite=Lax`. A cookie for gallery A is never transmitted on a request for
  gallery B, so cross-gallery replay fails at the transport layer before your
  code runs — and the handler still verifies `gallery_id` matches, because
  defence in depth means not trusting the browser to enforce your authorization.
- `SameSite=Lax`, not `Strict`, because a customer arrives by clicking a link
  from WhatsApp or email and `Strict` would drop the cookie on that first
  navigation. State this trade-off in the README.
- 2-hour idle expiry, 12-hour absolute. Revoked in bulk when the admin rotates
  the PIN, unpublishes, or the gallery expires — rotating the PIN must lock out
  everyone who already unlocked, and there must be a test proving it.
- No `__Host-` prefix here: that prefix forbids a `Path`, and the path scoping is
  worth more than the prefix.

**Middleware shape**

```ts
// one D1 read on the session_tokens PK, then the principal is on ctx
sessionAuth()      // resolves __Host-sid → { user, session }, else 401
galleryAuth()      // resolves the path-scoped cookie → { gallery }, else 401
requireEventRole(role)  // joins event_members, else 403 (or 404 to avoid leaking existence)
csrfGuard()        // non-GET: Origin/Sec-Fetch-Site + double-submit token match
```

The session lookup is a single primary-key read on an indexed column — under a
millisecond in D1, and it happens on the same round trip as the rest of the
request. Measure it and put the number in the README rather than asserting it.

---

## 3. Database Schema (D1 / SQLite)

Write this as Drizzle schema + generated SQL migrations. Every FK has
`ON DELETE CASCADE` or an explicit soft-delete policy — state which and why.

```sql
-- users -----------------------------------------------------------------
CREATE TABLE users (
  id                TEXT PRIMARY KEY,            -- ULID (sortable, k-ordered)
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT NOT NULL,               -- pbkdf2$<iters>$<salt_b64>$<hash_b64>
  display_name      TEXT NOT NULL,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,            -- epoch ms
  updated_at        INTEGER NOT NULL
);

-- team sessions (replaces any JWT/refresh-token scheme) -------------------
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,              -- ULID, safe to show the user
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,          -- sha256(raw token); raw is never stored
  csrf_token      TEXT NOT NULL,                 -- double-submit value, readable cookie
  user_agent_hash TEXT,
  ip_hash         TEXT,                          -- sha256(ip + IP_HASH_PEPPER)
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,              -- written at most every 5 min
  idle_expires_at INTEGER NOT NULL,              -- last_seen + 7d, slides
  absolute_expires_at INTEGER NOT NULL,          -- created + 30d, never slides
  revoked_at      INTEGER
);
CREATE INDEX idx_sessions_user  ON sessions(user_id, last_seen_at DESC, id DESC);
CREATE INDEX idx_sessions_sweep ON sessions(absolute_expires_at);

-- customer gallery sessions (created by a correct PIN) --------------------
CREATE TABLE gallery_sessions (
  id              TEXT PRIMARY KEY,
  gallery_id      TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,              -- +2h, slides
  absolute_expires_at INTEGER NOT NULL,          -- +12h, never slides
  revoked_at      INTEGER                        -- set in bulk on PIN rotate / unpublish
);
CREATE INDEX idx_gsessions_gallery ON gallery_sessions(gallery_id, created_at DESC, id DESC);
CREATE INDEX idx_gsessions_sweep   ON gallery_sessions(absolute_expires_at);

-- events -----------------------------------------------------------------
CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  event_date   INTEGER,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_events_owner_cursor ON events(owner_id, created_at DESC, id DESC);

-- membership (the authorization spine) -----------------------------------
CREATE TABLE event_members (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      TEXT NOT NULL,                       -- admin | member
  added_by  TEXT REFERENCES users(id),
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_members_user_cursor ON event_members(user_id, added_at DESC, event_id DESC);

-- photos (metadata only — bytes live in R2) -------------------------------
CREATE TABLE photos (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by    TEXT NOT NULL REFERENCES users(id),
  filename       TEXT NOT NULL,                  -- original client filename
  storage_key    TEXT NOT NULL UNIQUE,           -- events/<eid>/photos/<pid>.<ext>
  thumb_key      TEXT,                           -- derivative, nullable
  content_type   TEXT NOT NULL,
  file_size      INTEGER NOT NULL,               -- bytes
  width          INTEGER,
  height         INTEGER,
  dominant_color TEXT,                           -- '#3a4c61', extracted on confirm; LQIP ground
  checksum       TEXT,                           -- sha256, dedupe within event
  caption        TEXT,
  taken_at       INTEGER,                        -- EXIF DateTimeOriginal
  status         TEXT NOT NULL DEFAULT 'pending',-- pending | ready | failed | deleted
  is_selected    INTEGER NOT NULL DEFAULT 0,     -- admin's curation flag
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
-- THE pagination index. Composite, matches the keyset ORDER BY exactly.
CREATE INDEX idx_photos_event_cursor    ON photos(event_id, status, created_at DESC, id DESC);
CREATE INDEX idx_photos_uploader_cursor ON photos(event_id, uploaded_by, created_at DESC, id DESC);
CREATE INDEX idx_photos_selected        ON photos(event_id, is_selected, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_photos_dedupe   ON photos(event_id, checksum) WHERE checksum IS NOT NULL;

-- galleries ---------------------------------------------------------------
CREATE TABLE galleries (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,           -- 16+ chars, crypto random
  title          TEXT NOT NULL,
  cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  pin_hash       TEXT NOT NULL,                  -- same PBKDF2 scheme as passwords
  pin_set_at     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft | published | unpublished
  published_at   INTEGER,
  expires_at     INTEGER,                        -- NULL = never
  allow_download INTEGER NOT NULL DEFAULT 1,
  view_count     INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_galleries_event ON galleries(event_id, created_at DESC, id DESC);

-- immutable snapshot of what was published --------------------------------
CREATE TABLE gallery_photos (
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photo_id   TEXT NOT NULL REFERENCES photos(id)    ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (gallery_id, photo_id)
);
CREATE INDEX idx_gallery_photos_cursor ON gallery_photos(gallery_id, sort_order ASC, photo_id ASC);

-- brute-force protection ---------------------------------------------------
CREATE TABLE pin_attempts (
  id          TEXT PRIMARY KEY,
  gallery_id  TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  ip_hash     TEXT NOT NULL,                     -- sha256(ip + PEPPER), never raw IP
  success     INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_pin_attempts ON pin_attempts(gallery_id, ip_hash, attempted_at DESC);

-- audit log ----------------------------------------------------------------
CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT REFERENCES users(id),
  event_id     TEXT REFERENCES events(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,   -- gallery.published, photo.deleted, member.added, pin.rotated…
  target_type  TEXT,
  target_id    TEXT,
  metadata     TEXT,            -- JSON
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_audit_cursor ON audit_log(event_id, created_at DESC, id DESC);
```

**Design points to justify in the README:**

- ULIDs over UUIDv4 — lexicographically sortable, so `(created_at, id)` keyset
  tie-breaks are monotonic and index scans stay sequential.
- `gallery_photos` is a **snapshot**, not a live view of `photos.is_selected`.
  Unselecting a photo after publishing must not silently mutate what the client
  already paid for and bookmarked.
- Epoch-milliseconds integers over ISO strings — SQLite has no date type, and
  integer comparison keeps the keyset index tight.
- Every composite index column order **exactly matches** its `ORDER BY`.

---

## 4. Cursor-Based Pagination (the centrepiece — get this exactly right)

Offset pagination is broken for this product: 1 250 photos with concurrent
uploads means rows shift between requests, so users see duplicates and miss
photos, and `OFFSET 1200` makes SQLite walk 1 200 rows it throws away. Keyset
pagination is O(log n) regardless of depth and is stable under concurrent writes.

### 4.1 Cursor codec (`packages/shared/src/cursor.ts`)

An opaque, base64url-encoded, **signed** payload. Opaque so clients can't build
one; signed so a tampered cursor can't smuggle a predicate into your `WHERE`.

```ts
type CursorPayload = {
  v: 1;                       // version — lets you change sort keys later
  k: (string | number)[];     // sort key tuple, in ORDER BY order
  d: 'next' | 'prev';         // direction
  s: string;                  // sort-spec fingerprint, e.g. 'photos:created_desc'
};

encodeCursor(p: CursorPayload): string  // base64url(JSON) + '.' + base64url(hmacSha256)
decodeCursor(c: string, expectedSort: string): CursorPayload  // throws BadCursorError
```

Rules:
- HMAC key from `CURSOR_SECRET` (a Worker secret).
- On decode: verify signature → verify `v` → verify `s` matches the sort the
  endpoint is currently serving. A mismatch means the client is paging with a
  cursor from a different sort order; return `400 INVALID_CURSOR`, never a
  silently wrong page.
- Never leak DB internals in the payload beyond the sort key tuple.

### 4.2 Request / response contract (identical on every list endpoint)

**Query params** (Zod-validated):

```
limit   integer 1..100, default 24
cursor  opaque string, optional
sort    enum per endpoint, default 'newest'
```

**Response envelope:**

```jsonc
{
  "data": [ /* ...items... */ ],
  "pageInfo": {
    "nextCursor": "eyJ2IjoxLCJr...",   // null when exhausted
    "prevCursor": "eyJ2IjoxLCJr...",   // null on the first page
    "hasNextPage": true,
    "hasPrevPage": false,
    "limit": 24
  }
}
```

- **Never** return a total count on a hot path. If the UI needs "1,250 photos",
  serve it from a separate cached `GET /events/:id/stats` endpoint, or a
  denormalized counter — not a `COUNT(*)` on every page fetch. Explain this in
  the README.

### 4.3 The query

Fetch `limit + 1` rows to determine `hasNextPage` without a second query.

```sql
-- first page (sort=newest)
SELECT * FROM photos
WHERE event_id = ?1 AND status = 'ready'
ORDER BY created_at DESC, id DESC
LIMIT ?2;                                        -- ?2 = limit + 1

-- subsequent pages: strict row-value comparison on the composite key
SELECT * FROM photos
WHERE event_id = ?1 AND status = 'ready'
  AND (created_at, id) < (?2, ?3)                -- SQLite supports row values
ORDER BY created_at DESC, id DESC
LIMIT ?4;
```

If you prefer to stay ORM-portable, the expanded equivalent is:

```sql
AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
```

Write both, benchmark, keep the row-value form, and note in the README that it
lets SQLite seek directly into `idx_photos_event_cursor` instead of filtering.

**Direction handling:** for `prev`, flip the comparison to `>`, flip the
`ORDER BY` to `ASC`, then **reverse the result array in application code** so the
caller always receives rows in display order.

### 4.4 Sorts to support (each needs its own composite index + sort fingerprint)

| Endpoint | Sorts |
|---|---|
| `GET /events/:id/photos` | `newest` (`created_at DESC, id DESC`), `oldest`, `filename` (`filename ASC, id ASC`), `size` (`file_size DESC, id DESC`), `taken` (`taken_at DESC, id DESC` — NULLs last, handle explicitly) |
| `GET /gallery/:slug/photos` | `curated` (`sort_order ASC, photo_id ASC`) |
| `GET /events` | `newest` |
| `GET /events/:id/audit` | `newest` |

A nullable sort column (`taken_at`) needs an explicit null bucket in both the
`ORDER BY` and the keyset predicate — write a test that proves photos with no
EXIF still paginate without repeating or vanishing.

### 4.5 Frontend integration

```ts
const q = useInfiniteQuery({
  queryKey: ['photos', eventId, { sort, search, uploader }],
  queryFn: ({ pageParam }) => api.listPhotos({ eventId, cursor: pageParam, sort, ... }),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
});
```

- Flatten `data.pages.flatMap(p => p.data)` into **TanStack Virtual**'s
  `useVirtualizer`. Never render 1 250 DOM nodes.
- Trigger `fetchNextPage()` from an `IntersectionObserver` sentinel placed ~600 px
  before the end, guarded by `hasNextPage && !isFetchingNextPage`.
- Changing `sort` / filters changes the query key → fresh cursor chain. Show
  `placeholderData: keepPreviousData` so the grid doesn't flash empty.
- Optimistic select/deselect writes into the cached pages by photo id, with
  rollback on error.
- Skeleton tiles sized from the stored `width`/`height` so the grid never
  reflows as images stream in.

### 4.6 Tests that must exist for pagination

1. Walking every page of a 500-row seed yields exactly 500 unique ids, in order.
2. Inserting 10 new photos mid-walk never causes a duplicate or a skip of
   pre-existing rows.
3. Deleting the row a cursor points at still returns the correct next page.
4. A tampered cursor → `400 INVALID_CURSOR`.
5. A cursor minted under `sort=newest` replayed against `sort=filename` → `400`.
6. `limit=0`, `limit=101`, `limit=abc` → `422` with field-level detail.
7. Last page returns `nextCursor: null` and `hasNextPage: false`.
8. `prev` from page 3 returns page 2 in display order, byte-identical to the
   forward walk.
9. Rows with `taken_at IS NULL` paginate correctly under `sort=taken`.

---

## 5. API Surface

Base: `/api/v1`. All responses JSON. All errors use one envelope.

### Error envelope

```jsonc
{
  "error": {
    "code": "PIN_INVALID",           // stable machine code, SCREAMING_SNAKE
    "message": "That PIN doesn't match. 3 attempts left.",  // user-facing, plain
    "details": [{ "path": "pin", "message": "Must be 6 digits" }],
    "requestId": "01J8..."           // echoed in logs for support
  }
}
```

Codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
`VALIDATION_FAILED` 422, `INVALID_CURSOR` 400, `PIN_INVALID` 401,
`PIN_LOCKED` 429, `GALLERY_EXPIRED` 410, `GALLERY_NOT_PUBLISHED` 404 (deliberately
404, not 403 — don't confirm existence), `UPLOAD_FAILED` 400,
`FILE_TOO_LARGE` 413, `UNSUPPORTED_TYPE` 415, `RATE_LIMITED` 429,
`CONFLICT` 409, `INTERNAL` 500.

### Endpoints

**Auth**
```
POST   /auth/register              { email, password, displayName }  → user + tokens
POST   /auth/login                 { email, password }               → user + tokens
POST   /auth/logout                → deletes the session row
GET    /auth/me                    → current user + event memberships + csrfToken
GET    /auth/sessions              → this user's active sessions, "this device" flagged
DELETE /auth/sessions/:id          → end one session
POST   /auth/sessions/revoke-all   → end every session except the current one
POST   /auth/accept-invite         { token, password, displayName }
```

**Events**
```
POST   /events                     admin only
GET    /events                     ?limit&cursor&sort   — only events you belong to
GET    /events/:id                 membership required
PATCH  /events/:id                 event admin only
GET    /events/:id/stats           { totalPhotos, selected, uploaders[], storageBytes }
GET    /events/:id/audit           ?limit&cursor        — event admin only
```

**Members**
```
POST   /events/:id/members         { email, role } — creates or links user, mails invite
GET    /events/:id/members         ?limit&cursor
PATCH  /events/:id/members/:userId { role }
DELETE /events/:id/members/:userId — cannot remove the last admin (409)
```

**Photos**
```
POST   /events/:id/photos/upload-intent
       { files: [{ filename, contentType, fileSize, checksum? }] }   // max 50 per call
       → { uploads: [{ photoId, uploadUrl, storageKey, expiresAt }] }
POST   /events/:id/photos/confirm
       { items: [{ photoId, width?, height?, takenAt? }] }           // idempotent
GET    /events/:id/photos          ?limit&cursor&sort&search&uploaderId&selected&from&to
PATCH  /photos/:id                 { caption?, isSelected? }         — event admin, or owner for caption
POST   /events/:id/photos/select   { photoIds: string[], selected: boolean }  // bulk, ≤500
DELETE /photos/:id                 — event admin, or uploader within 15 min of upload
GET    /photos/:id/download        — signed, short-lived R2 redirect
```

**Galleries (admin)**
```
POST   /events/:id/galleries       { title, photoIds[] | useSelected: true, expiresAt?, allowDownload? }
                                   → { gallery, url, pin }   // PIN returned EXACTLY ONCE
GET    /events/:id/galleries       ?limit&cursor
PATCH  /galleries/:id              { title?, expiresAt?, allowDownload?, coverPhotoId? }
POST   /galleries/:id/publish
POST   /galleries/:id/unpublish
POST   /galleries/:id/rotate-pin   → { pin }   // shown once
DELETE /galleries/:id
```

**Public gallery (no account)**
```
GET    /public/galleries/:slug            → { title, photoCount, coverThumbUrl, requiresPin: true }
                                            404 if draft/unpublished; 410 if expired
POST   /public/galleries/:slug/unlock     { pin }
                                          → 204 + Set-Cookie: gsid, Path=/api/v1/public/galleries/<slug>
GET    /public/galleries/:slug/photos     gallery cookie, ?limit&cursor
GET    /public/galleries/:slug/photos/:id/download   gallery cookie
POST   /public/galleries/:slug/download-all          gallery cookie → streamed ZIP
POST   /public/galleries/:slug/lock       ends the gallery session ("Lock this gallery")
```

**System**
```
GET    /health                     liveness
GET    /ready                      D1 + R2 reachable
GET    /openapi.json               OpenAPI 3.1 document
GET    /docs                       Swagger UI (try-it-out)
GET    /redoc                      Redoc reference
```

### Image delivery

```
GET /img/:variant/:storageKey   variant ∈ thumb(400w) | preview(1600w) | full
```
Worker validates the caller's right to that key (team session or gallery session), then
streams from R2 through Cloudflare Image Resizing with
`Cache-Control: private, max-age=3600` for authed views and
`public, max-age=31536000, immutable` for content-addressed gallery derivatives.
R2 buckets are **never** public.

### API documentation (Swagger + Redoc) — required, not optional

The reviewer must be able to understand and exercise the whole API without
reading a line of source. Build the spec **from the code**, never alongside it.

Every route is declared with `@hono/zod-openapi`'s `createRoute`, so the Zod
schema that validates the request is the same object that documents it. A drifted
spec becomes impossible rather than merely discouraged.

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

const listPhotosRoute = createRoute({
  method: 'get',
  path: '/events/{eventId}/photos',
  tags: ['Photos'],
  summary: 'List photos in an event',
  description:
    'Cursor-paginated. Pass `pageInfo.nextCursor` from the previous response ' +
    'as `cursor`. Cursors are signed and bound to the `sort` that minted them.',
  security: [{ sessionAuth: [] }],
  request: {
    params: EventIdParam,
    query: PhotoListQuery,          // limit, cursor, sort, search, uploaderId…
  },
  responses: {
    200: { description: 'A page of photos', content: { 'application/json': { schema: PhotoPage } } },
    401: ErrorResponse('UNAUTHENTICATED'),
    403: ErrorResponse('FORBIDDEN'),
    400: ErrorResponse('INVALID_CURSOR'),
    422: ErrorResponse('VALIDATION_FAILED'),
  },
});
```

**Mounted routes**

```
GET /openapi.json     OpenAPI 3.1 document, generated at request time
GET /docs             Swagger UI  — try-it-out enabled, for exercising the API
GET /redoc            Redoc       — the readable reference, for understanding it
```

Why both: Swagger UI is the console (a reviewer logs in, then fires real
requests with their own session cookie); Redoc is the document (three-pane, searchable, renders long
descriptions and schema examples properly). They serve the same
`/openapi.json`, so they can never disagree.

**Requirements**

- **Tags** grouping every route: `Auth`, `Events`, `Members`, `Photos`,
  `Galleries`, `Public Gallery`, `Media`, `System`. Tag order in the spec
  controls sidebar order in Redoc — order it as the workflow runs, not
  alphabetically.
- **Security schemes**: `sessionAuth` (`apiKey`, `in: cookie`, name `__Host-sid`)
  and `galleryAuth` (`apiKey`, `in: cookie`, name `gsid`). Each route declares
  which it needs, so "who can call this" is visible in the docs, not just in the
  middleware. Because the API and the docs are served from **one origin**, the
  browser attaches the session cookie automatically — Swagger UI's "Try it out"
  works after a normal login in another tab, with no token to paste. Set
  `requestInterceptor` to add the CSRF header from the readable `csrf` cookie so
  non-GET try-it-out calls aren't rejected, and say so in the docs description.
- **Every documented response includes the error envelope** with its real
  `code`, plus at least one worked `example`. The `PIN_LOCKED` response shows
  the `Retry-After` header. `GALLERY_NOT_PUBLISHED` carries a note explaining
  it is deliberately a 404.
- **Cursor pagination is documented as a concept**, not just a query param:
  the `PageInfo` schema gets a description explaining `nextCursor`/`hasNextPage`,
  and the spec's `info.description` (Markdown, rendered by Redoc) contains a
  short "How to paginate" section with a copy-pasteable curl loop.
- **Examples on request bodies** — a real `upload-intent` payload, a real
  publish payload — so try-it-out works on the first click.
- **Redoc `x-tagGroups`**: split the sidebar into **"Team API"** (authenticated)
  and **"Customer API"** (public gallery), because those are two genuinely
  different audiences.
- **Spec drift is a CI failure.** A test snapshots `/openapi.json` and fails if
  it changes without the snapshot being updated in the same commit. A second
  test validates the document against the OpenAPI 3.1 schema so a malformed
  spec can't ship.
- `/docs` and `/redoc` are **public in preview, gated in production** — put them
  behind a `DOCS_ENABLED` env flag or basic auth so the demo reviewer can reach
  them via a documented URL while the API surface isn't advertised to the world.
  Put that URL and any credential in the README.
- Link `/redoc` from the admin UI footer so the reviewer finds it without
  hunting.

Generate a static `docs/openapi.json` on build and commit it, so the repository
alone documents the API even when the deployment is gone.

---

## 6. Upload Pipeline

1. Client hashes each file (SHA-256, streaming, in a Web Worker so the UI stays
   responsive) and calls `upload-intent`.
2. Server validates: membership, MIME allowlist (`image/jpeg|png|webp|avif|heic`),
   per-file size cap (25 MB), per-event quota, and dedupe by `(event_id, checksum)`.
   It inserts `photos` rows with `status='pending'` and returns **presigned R2 PUT
   URLs** (signed with `aws4fetch`, 15-minute TTL, `Content-Length` and
   `Content-Type` pinned into the signature).
3. Client `PUT`s directly to R2 — bytes never pass through the Worker, so uploads
   aren't bounded by Worker request limits. Concurrency 4, exponential backoff,
   per-file progress via `XMLHttpRequest.upload.onprogress`, per-file retry, and
   cancel via `AbortController`.
4. Client calls `confirm` with dimensions + EXIF. Server flips `status='ready'`
   and enqueues thumbnail generation.
5. **Orphan reaper**: a Cron Trigger every 30 min deletes `pending` rows older
   than 1 hour and their R2 objects. Failed uploads must not leak storage or
   phantom rows. Write a test for this.

Failure UX: a failed file shows inline in the upload tray with the actual reason
("File is 41 MB — the limit is 25 MB") and a **Retry** button. Successful files in
the same batch are unaffected. Never a generic "Upload failed."

---

## 7. Security Requirements

Implement each and write a test that proves it.

| Threat | Control |
|---|---|
| Cross-event access | Every handler resolves membership via `event_members` before any read/write. Middleware: `requireEventRole(eventId, 'admin' \| 'member')`. |
| Member publishing a gallery | `requireEventRole('admin')` on all gallery mutations → `403 FORBIDDEN`. |
| Member mutating others' photos | Ownership check on `PATCH`/`DELETE /photos/:id`. |
| Unpublished photo access | Public routes join `gallery_photos` + `galleries.status='published'` + expiry. A selected-but-unpublished photo id is a `404`. |
| PIN brute force | PBKDF2-hashed PIN, constant-time compare, 5 attempts / 15 min / (gallery, ip_hash), then `429 PIN_LOCKED` with `Retry-After`. Log to `pin_attempts`. |
| Gallery slug enumeration | ≥16 chars of `crypto.getRandomValues` base32; unknown slug and draft slug both return the same `404` shape. |
| Session theft | Opaque 256-bit token, `__Host-sid` cookie, `HttpOnly` so JS can never read it, `Secure`, `SameSite=Strict`. Only `sha256(token)` is stored, so a DB dump grants no sessions. Id rotates on login and privilege change. |
| Stale access after removal | Sessions are server-side rows: removing a member or revoking a session ends access on the **next request**. Test it — remove a member mid-session and assert the next call is 403. |
| Gallery session scope | Gallery cookie is path-scoped to `/api/v1/public/galleries/<slug>`, so the browser never sends it to another gallery; the handler independently verifies `gallery_id`. Rotating the PIN, unpublishing, or expiry revokes every gallery session in bulk. |
| Session fixation | New session id issued on every login; any pre-existing cookie value is discarded, never adopted. |
| Direct object access | R2 bucket private; all reads go through the Worker or short-lived signed URLs. |
| XSS | React escaping + strict CSP header, no `dangerouslySetInnerHTML`. |
| CSRF | Cookie auth makes this real, not theoretical: `SameSite=Strict` on the team cookie, plus a double-submit token (`csrf` readable cookie echoed in an `X-CSRF-Token` header) and an `Origin`/`Sec-Fetch-Site` check on every non-GET. The gallery cookie is `SameSite=Lax`, so its one state-changing route (`unlock`) is rate-limited and idempotent by design. |
| Enumeration on login | Same message and similar timing for unknown email vs. wrong password. |
| Oversized payloads | Body size limits, `limit ≤ 100`, bulk arrays ≤ 500 ids. |
| Secret leakage | `.dev.vars`, `.env*` gitignored; `wrangler secret put` in prod; a CI job greps the diff for high-entropy strings. |
| Docs exposing prod surface | `/docs` and `/redoc` gated behind `DOCS_ENABLED` (or basic auth) in production; the spec never contains real tokens, real slugs, or real PINs in its examples. |

Response headers on every request: `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy`, and a real CSP.

---

## 8. Frontend Scope

### Routes (TanStack Router)

```
/                              → redirect: authed ? /events : /login
/login
/register
/invite/$token
/events                        → event list (cursor infinite scroll)
/events/$eventId               → overview + stats
/events/$eventId/photos        → virtualized grid, search/filter/sort, bulk select
/events/$eventId/upload        → drag-drop tray with per-file progress
/events/$eventId/team          → TanStack Table roster (admin only)
/events/$eventId/galleries     → gallery list
/events/$eventId/galleries/new → curation → publish → credentials reveal
/gallery/$slug                 → PIN gate (public)
/gallery/$slug/view            → published gallery (public, gallery-session-gated)
```

`beforeLoad` guards redirect unauthenticated users with a `redirect` search param
and enforce role on admin-only routes. A member who types an admin URL gets a
purposeful "You don't have access to this" screen with a route back — not a blank
page or a crash.

### 8.1 Admin surfaces — Ant Design (`/events/*`)

Optimize for **density, speed, and zero ambiguity**. A lead culling 1 250 photos
at midnight wants information per pixel and keyboard reach, not whitespace.

**Tables (`antd Table`) — the roster, upload manifest, gallery list, audit log**

- `pagination={false}` on **every** table. Antd's built-in pager is page-number
  based and would silently reintroduce `OFFSET` thinking; drive the rows from
  `useInfiniteQuery` instead, with either a **"Load more"** footer button showing
  what's loaded ("120 of 1,250 loaded") or scroll-triggered fetching inside
  `scroll={{ y }}`. Write a comment in the table component saying why the built-in
  pager is disabled — the reviewer will look for exactly this.
- Column sorting is **server-driven**: `sorter: true` + `onChange` maps to the
  `sort` query param, which resets the cursor chain. Never `sorter: (a,b)=>…`,
  which would sort only the rows currently loaded and lie to the user.
- Column filters (`filters` + `filteredValue`, `Select` for uploader,
  `DatePicker.RangePicker` for date) are likewise server-driven and compose into
  the keyset query.
- `rowSelection` with `preserveSelectedRowKeys: true` so a selection survives
  pagination, plus "select all matching this filter" that sends the filter, not
  1 250 ids.
- `sticky` header, `size="middle"`, `rowKey="id"`, `Empty` with a real next
  action, and `loading` bound to the query's `isFetching`.

**Popovers, drawers, and the rest of the antd surface — use them where they earn it**

| Where | Component | Why |
|---|---|---|
| Photo thumbnail in a table row | `Popover` with a larger preview + EXIF `Descriptions` on hover/focus | inspect without leaving the row |
| Gallery PIN | `Popover` holding "Reveal PIN" → `Typography.Text copyable` | keeps a credential off-screen by default |
| Member row actions | `Popconfirm` on remove, with the consequence spelled out | destructive action, one keystroke away |
| Photo detail | `Drawer` (right, 480 px) with metadata, uploader, storage key, audit trail | side-by-side with the grid, no navigation lost |
| Bulk actions | sticky `Space` bar + `Modal.confirm` for anything destructive | count always visible |
| Publish flow | `Steps` inside a `Modal` — select → configure → publish → credentials | genuinely sequential, so numbered steps are honest here |
| Storage / quota | `Progress` + `Statistic` on the event overview | at-a-glance |
| Status | `Tag` colour-coded: `ready` / `pending` / `failed` / `selected` | scannable in a dense table |
| Filters | `Segmented` for All / Selected / Unselected | one click, no dropdown |
| Feedback | `notification` for async results, `message` for instant ones | never a bare alert |
| Expiry | `Tooltip` on a countdown badge showing the exact timestamp | relative time plus truth |

- Wrap the admin tree in one `ConfigProvider` carrying the shared theme tokens
  and `componentSize="middle"`. Dark algorithm by default.
- Keyboard: `/` focuses search, `a` toggles select-all, `Esc` closes drawer,
  arrows move the grid cursor, `space` toggles selection, `shift+click` selects a
  range. Document the shortcuts in a `?` help popover.
- Antd's `Upload` handles the drop zone and file list, but **custom
  `customRequest`** — uploads go to the presigned R2 URL, not through the Worker.

### 8.2 Customer surfaces — shadcn/ui (`/gallery/*`)

Optimize for **calm, trust, and the photographs**. This is a client who was
handed a link; every element that isn't a photograph must justify itself.

- Components from shadcn/ui only: `input-otp` for the PIN, `Dialog` for the
  lightbox, `Button`, `Sonner` for toasts, `Skeleton`, `AspectRatio`,
  `Tooltip`, `DropdownMenu` for download options.
- **PIN gate**: shadcn `input-otp`, 6 slots, paste-a-whole-PIN support,
  auto-submit on the sixth character, autofocus, `inputMode="numeric"`. Wrong PIN
  shakes once (respecting `prefers-reduced-motion`), clears, refocuses slot one,
  and states attempts remaining in words. Lockout shows a live countdown and
  never blames the user.
- **Grid**: virtualized, aspect-preserving, gutters that breathe. Skeletons sized
  from the stored `width`/`height` so nothing reflows. Infinite scroll with a
  sentinel — no buttons, no page numbers, no spinner-jank.
- **Lightbox**: shadcn `Dialog`, arrow keys and swipe, preloads neighbours,
  pinch/scroll zoom, `Esc` to close, focus trapped, `aria-modal`, and the photo
  count as "14 of 600" rather than a progress bar.
- **Download**: single-photo download from the lightbox; "Download all" shows a
  size estimate before starting and streams with visible progress. Hidden
  entirely when `allow_download` is false — disabled buttons that do nothing are
  worse than absent ones.
- **Expired / not-found**: a composed page, in the gallery's own voice, saying
  what happened and who to contact. Never a stack trace, never a bare 404.
- Mobile is the primary target here — most clients open the link on a phone.
  Design 375 px first, thumb-reachable controls, 44 px minimum touch targets.
- No login prompt, no account nudge, no cookie banner beyond what's legally
  required. The client came to see photographs.

### 8.3 Applies to both

- **Empty / error / loading states for every list.** Empty states say what to do
  next ("No photos yet — upload the first batch"), not "No data".
- Responsive at 375 / 768 / 1280 / 1920 px. Visible keyboard focus everywhere.
  `prefers-reduced-motion` respected. WCAG AA contrast.
- Error copy names the cause and the fix, in the interface's voice. No apologies,
  no "Something went wrong".
- An action keeps its name through the whole flow: the button says **Publish**,
  the toast says **Published**.
- **Every photograph is lazy-loaded and every grid is virtualized** — both, not
  one or the other. Reference implementation in §16.5; the rules it encodes
  (reserved aspect boxes, `dominant_color` ground, `srcset`, one shared
  observer, priority hints for the first screenful, decode before reveal) are
  requirements, not suggestions.
- **Performance budget, measured on a throttled mid-range mobile profile:**
  cumulative layout shift **0** on the photo grid, LCP under 2.5 s on the public
  gallery, and a sustained 60 fps flick through 1 250 tiles. Put the numbers in
  the README; if you miss one, say by how much.

### Design direction

Load the `frontend-design` skill and run its two-pass process (plan → critique →
build) **before** writing components. Constraints for this brief:

- Subject: a working tool for professional event photographers plus a gallery
  their clients see. The tool half should feel like a fast, dense, confident
  darkroom app; the client-facing gallery half should get out of the way and let
  the photographs be the entire design.
- The photographs are the only decoration. Chrome stays quiet.
- **Banned** (these are AI-design tells, not choices): cream `#F4F1EA` grounds
  with terracotta `#D97757` accents; tracked-out ALL-CAPS eyebrow labels above
  every heading; `01 / 02 / 03` numbered markers on non-sequences; identical
  rounded cards with the same `rgba(0,0,0,.1)` shadow everywhere; `→` glued to
  button text; meta strings joined with `·`; gradient washes as decoration.
- Pick one memorable element and spend your boldness there. Everything else stays
  disciplined.
- Express the palette and type scale as Tailwind v4 `@theme` tokens so the two
  halves share one system. Dark mode is the default for the admin tool (people
  cull photos in dark rooms); the client gallery adapts to the viewer's theme.
- **Neither half may look stock.** Antd out of the box is instantly recognisable
  as antd — override `colorPrimary`, `borderRadius`, `fontFamily`, `colorBgBase`,
  `controlHeight`, and the table row/hover tokens through `ConfigProvider` until
  the admin reads as *your* tool that happens to use antd's mechanics. shadcn out
  of the box is equally recognisable — replace the default zinc/slate palette and
  the uniform `rounded-lg`, and set your own type scale rather than shipping
  `--radius: 0.5rem` and Inter.
- Both kits pull from the **same** token file. If a reviewer opens the admin and
  the gallery side by side, they should read as one company's work in two
  registers — instrument and exhibition — not as two products.

After building, run the `web-design-reviewer` skill at all four viewports on both
the admin tool and the public gallery, and fix what it finds.

---

## 9. Bonus Features — implement ALL of them

The brief lists these as optional. Do every one; they are where the submission
separates itself.

1. **Thumbnails / resizing** — `thumb` (400w) and `preview` (1600w) variants via
   Cloudflare Image Resizing, generated on first request and cached. Grid loads
   thumbs, lightbox loads preview, download serves the original. Served through
   `srcset` so the device picks, not the server, and **lazy-loaded** with a
   shared `IntersectionObserver`, reserved aspect boxes, a `dominant_color`
   placeholder, priority hints on the first screenful, and reveal only after
   `img.decode()` resolves — §16.5.
2. **Cursor pagination + infinite scroll** — §4, on every list surface.
3. **Search & filtering** — filename substring (SQLite `LIKE` with a lowercased
   generated column, or FTS5 if you can get it into D1), plus filters for
   uploader, date range, selected/unselected, file size band. Filters compose
   into the keyset query without breaking the cursor.
4. **Bulk upload** — multi-file + folder drop, 4-way concurrency, per-file retry,
   whole-batch cancel, duplicate detection by checksum before upload starts.
5. **Photo downloading** — single-photo signed download, and **download-all as a
   streamed ZIP** (store-only, no compression — JPEGs don't compress) fed by a
   **bounded prefetch window** so a few objects are in flight while entries are
   written in order, and memory is bounded by the window rather than the gallery.
   Reference implementation in §16.4. Gated on `allow_download`.
6. **Gallery expiration** — `expires_at`, enforced server-side on every public
   read, surfaced to the customer as a clean "This gallery expired on 4 Nov" page,
   and shown to the admin as a countdown badge with a one-click extend.
7. **CDN** — Cloudflare edge caching with correct `Cache-Control` and `Vary`,
   content-addressed derivative keys so cached objects are immutable, and cache
   purge on photo delete. Document the cache-hit path in the README.
8. **CI/CD** — GitHub Actions: typecheck, lint, unit + integration, Playwright,
   build, then `wrangler d1 migrations apply --remote` and deploy Worker + Pages.
   PRs get a preview deployment and a comment with the URL.
9. **Extras that cost little and show judgment**:
   - EXIF extraction (camera, lens, ISO, shutter, `taken_at`) shown in the
     lightbox info panel.
   - Audit log with its own cursor-paginated view.
   - Rate limiting on auth and PIN endpoints.
   - `/health` and `/ready` endpoints; structured request logs with `requestId`.
   - Idempotency keys on upload confirm.
   - Soft delete + 30-day restore for photos.
   - Interactive API docs (Swagger UI + Redoc) generated from the same Zod
     schemas that validate requests — see §5.
   - Gallery view counter and a "last opened" timestamp for the admin.

---

## 10. Testing Requirements

`pnpm test` must pass from a clean clone. Target ≥80% line coverage on
`apps/api/src/{routes,services,lib}`.

**Integration (Vitest + `@cloudflare/vitest-pool-workers`, real D1, real migrations):**

- Auth: register, login, wrong password, duplicate email, logout deletes the
  session row, a revoked session's cookie returns 401 on the very next request.
- Sessions: id rotates on login (the pre-login cookie value is not adopted);
  sliding idle expiry extends a live session; absolute expiry ends one that is
  still active; `revoke-all` ends every session but the caller's; `last_seen_at`
  is not written more than once per 5 minutes.
- Removal takes effect immediately: remove a member while their session is live,
  then assert their next event request is 403 with no re-login needed.
- CSRF: a non-GET without the `X-CSRF-Token` header → 403; with a token from a
  different session → 403; with a foreign `Origin` → 403.
- Gallery sessions: the cookie from gallery A sent to gallery B is rejected even
  when the browser's path scoping is bypassed; rotating the PIN revokes every
  existing gallery session; unpublishing and expiry do the same.
- Authorization matrix — one test per row of §7's table.
- Member attempting `POST /galleries/:id/publish` → 403.
- Member requesting another event's photos → 404 (not 403 — don't confirm
  existence).
- Photo access control: selected-but-unpublished photo id via the public route → 404.
- Gallery: create → publish → unlock with correct PIN → list photos → download.
- PIN: wrong PIN → 401 with attempts remaining; 6th attempt → 429 with
  `Retry-After`; correct PIN after lockout expiry → 200.
- Expired gallery → 410 on unlock **and** on photo list with a still-valid
  gallery session.
- Upload: intent → presign → confirm → `status='ready'`; failed confirm leaves
  `pending`; reaper cleans it.
- All nine pagination tests from §4.6.
- Validation: every endpoint rejects malformed bodies with `422` + field paths.

**E2E (Playwright):** the full five-step workflow end to end, plus the customer
path on a mobile viewport, plus a member hitting an admin route.

**Async primitives (§16.3):** `mapPool` never exceeds its concurrency limit
(instrument with a live counter); a single rejection does not fail the batch;
aborting mid-flight stops scheduling new work. `prefetch` keeps exactly `window`
promises in flight, yields in input order, propagates a rejection at *its* turn
rather than as an unhandled rejection, and does not over-pump past the end.
`withRetry` stops on non-retryable errors, honours the attempt cap, and rejects
promptly on abort instead of sleeping out the backoff.

**Unit:** cursor encode/decode round-trip and tamper rejection, PBKDF2
hash/verify, session token generation entropy and hashing, cookie attribute
builder (`__Host-` prefix rules, path scoping), PIN generation entropy, ZIP
stream framing, keyset predicate builder.

**API spec:** `/openapi.json` validates against the OpenAPI 3.1 schema; a
committed snapshot fails CI when a route changes without the spec being
regenerated in the same commit; every route in the Hono app appears in the
document (no undocumented endpoints); `/docs` and `/redoc` return 200 and load
the spec.

**Codegen freshness:** `pnpm gen:api` in CI must produce a clean `git diff` — a
route change without a regenerated client fails the build. A second check counts
`InfiniteOptions` in the generated TanStack Query file and fails if it drops, so
a spec change can't silently downgrade a paginated endpoint to a plain query.

**Stores (Vitest):** `useAuthStore` is never written to `localStorage` (assert
the storage is untouched after login — this is the test that stops someone
"helpfully" adding `persist` later); `clear()` on a 401 leaves `status: 'anon'`,
not `'unknown'`; `roleIn` returns null for an event the user has no membership
in. `useThemeStore` persists only `preference` and never `resolved`; switching
the OS theme while `preference === 'system'` updates `resolved`; the value the
inline no-FOUC script reads and the value the store writes use the same key.

**Component (Vitest + Testing Library):** the antd `Table` wrapper never renders
a page-number pager; server-side `sorter` fires the query with the new `sort` and
a cleared cursor; `rowSelection` survives loading a second page; the shadcn PIN
input accepts a pasted 6-digit string, auto-submits, and refocuses slot one after
a rejection.

---

## 11. Deployment

- **API**: Cloudflare Workers, `wrangler deploy`. Bindings: `DB` (D1),
  `BUCKET` (R2), `KV` (optional cache). Secrets: `CURSOR_SECRET`, `PIN_PEPPER`,
  `IP_HASH_PEPPER`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. (No JWT signing
  secrets — sessions are opaque and stored, not signed.)
- **One origin**: route the Worker at `example.com/api/*`, `/img/*`, `/docs`,
  `/redoc`; Pages serves the SPA on the same hostname. This is what makes
  first-party `SameSite=Strict` cookies possible and removes CORS entirely.
- **Cron Trigger** sweeps expired `sessions` and `gallery_sessions` hourly,
  alongside the orphan-upload reaper.
  Plus `DOCS_ENABLED` (and `DOCS_BASIC_AUTH` if you gate production docs).
- **Web**: Cloudflare Pages, `pnpm --filter web build`, output `dist`,
  `VITE_API_URL` set per environment.
- **Environments**: `preview` and `production` in `wrangler.toml` with separate
  D1 databases and R2 buckets. Migrations run in CI before deploy.
- **Local dev**: `wrangler dev` with local D1 + local R2 (miniflare persistence),
  `pnpm dev` runs API and web together. `pnpm db:seed` loads demo data.

### Seed script (`pnpm db:seed`) must create

- Admin: `admin@demo.trizen.dev` / a documented demo password.
- Two members: `member1@…`, `member2@…`.
- Event **"Arjun & Priya Wedding"** with **1 250 photo rows** (small generated
  JPEGs or a handful of real images referenced by many rows — say which in the
  README) split across both members, with realistic `created_at` spread so
  pagination is genuinely exercised.
- **600** photos flagged `is_selected`.
- One published gallery with those 600 photos, a known PIN, and a printed
  `https://<domain>/gallery/<slug>` URL.
- A second event the demo admin is **not** a member of, so the reviewer can
  personally verify the cross-event 404.

---

## 12. README.md (required)

Sections, in this order:

1. **What this is** — two paragraphs, the problem and the shape of the solution.
2. **Live demo** — app URL, gallery URL, PIN, admin creds, member creds, and one
   line telling the reviewer exactly what to click to see the whole flow in 90
   seconds.
3. **Tech stack & why** — the honest reasoning, including what you gave up.
4. **Architecture** — a Mermaid diagram (browser → Pages → Worker → D1/R2 →
   Image Resizing → CDN) plus the upload sequence and the gallery-unlock sequence
   as Mermaid sequence diagrams.
5. **Database design** — ER diagram, table-by-table rationale, index rationale,
   the `gallery_photos` snapshot decision.
6. **Cursor pagination** — the whole §4 story: why not offset, the codec, the
   query, the index, the signature, the sort-fingerprint guard, and a benchmark
   table (offset vs. keyset at rows 0 / 600 / 1 250).
7. **API reference** — endpoint table with auth requirements and error codes,
   plus prominent links to the **live Swagger UI (`/docs`)** and **Redoc
   (`/redoc`)**, a screenshot of the Redoc sidebar, and the committed
   `docs/openapi.json` for readers with no live deployment.
8. **UI approach** — why the admin runs on Ant Design and the customer gallery on
   shadcn/ui, how one Tailwind `@theme` token set feeds both, and how the bundles
   are split so antd never reaches the gallery. Include a screenshot of each half.
   Also: the **Zod → OpenAPI → Hey API** chain diagram, and the state split —
   server data in TanStack Query, client state in four Zustand stores, and why
   the auth store is deliberately not persisted.
9. **Security model** — the §7 table with a link to the test proving each row,
   plus a subsection on **why sessions instead of JWTs**: instant revocation, no
   token reachable from JavaScript, no refresh-rotation machinery, and the
   single-origin deployment that makes `SameSite=Strict` viable. Name what you
   gave up (stateless verification) and why it costs nothing here.
10. **Local setup** — clone → `pnpm i` → D1 create → migrate → seed → dev, exact
    commands, and a full `.dev.vars.example`.
11. **Environment variables** — table: name, where used, how to generate, prod vs. dev.
12. **Deployment** — step by step, including first-time D1/R2 creation and CI secrets.
13. **Testing** — how to run each suite and what each covers.
14. **Known limitations & what I'd do next** — be specific and honest. D1's single
    writer and 100 MB ceiling, no real thumbnail queue, no email delivery in the
    demo, ZIP downloads unbounded in wall-clock time, etc.

---

## 13. Repository & Git Hygiene

```
.
├── apps/
│   ├── api/          # Hono Worker: routes/ services/ db/ lib/ middleware/ tests/
│   └── web/
│       ├── routes/admin/    # antd tree — lazy, never in the gallery chunk
│       ├── routes/gallery/  # shadcn tree — lazy, no antd import allowed
│       ├── components/ui/   # shadcn components, owned and restyled
│       ├── stores/          # Zustand: auth, theme, upload, selection — client state only
│       ├── theme/           # Tailwind @theme tokens + antd ConfigProvider mapping
│       └── lib/ features/
├── packages/
│   ├── shared/       # Zod schemas, cursor codec, async primitives, error codes
│   └── api-client/   # GENERATED by `pnpm gen:api` — never edit, always committed
├── .github/workflows/ci.yml
├── docs/architecture.md
├── docs/openapi.json      # generated on build, committed
├── openapi-ts.config.ts   # Hey API codegen config
├── README.md
└── .gitignore
```

`.gitignore` must include: `node_modules`, `dist`, `.wrangler`, `.dev.vars`,
`.env*`, `*.local`, `.claude/skills/`, `coverage`, `playwright-report`,
`test-results`, `.DS_Store`.

Conventional commits, small and readable. Never commit a secret — if one ever
lands, rotate it and say so in the PR.

---

## 14. Build Order

| Phase | Deliverable |
|---|---|
| 1 | Monorepo, Tailwind v4, Hono skeleton, D1 + Drizzle migrations, `/health` |
| 2 | Auth: register/login/logout/me, PBKDF2, session table + cookie + CSRF middleware, session management endpoints, tests |
| 3 | Events + membership + the authorization matrix, tests |
| 4 | **Cursor codec + generic keyset helper + its 9 tests** (§16.1–16.2, before any list endpoint) |
| 4b | **`packages/shared/src/async.ts`**: `mapPool`, `prefetch`, `withRetry` + tests (§16.3) — uploads, downloads and the ZIP all depend on it |
| 5 | Upload pipeline: intent → R2 presign → confirm → reaper, tests |
| 6 | Photo list with cursor + search + filters + sorts |
| 6b | **`@hono/zod-openapi` migration + `/docs` + `/redoc` + spec snapshot test** — do it while there are few routes, not at the end |
| 6c | **`pnpm gen:api`**: Hey API client, Zod, and TanStack Query hooks generated from the spec, wired into CI. Every frontend call from here on uses the generated SDK |
| 7 | Frontend shell: router, Zustand auth + theme stores, no-FOUC theme script, auth guards, split admin/gallery trees, Tailwind `@theme` tokens wired into antd `ConfigProvider`, shadcn init |
| 8 | Admin: virtualized photo grid + infinite scroll + selection + lightbox; antd tables with pagination disabled and server-driven sort |
| 9 | Upload tray with progress and retry |
| 10 | Galleries: create, publish, PIN, rotate, expire |
| 11 | Public gallery (shadcn): PIN gate, path-scoped gallery session, cursor-paginated view, downloads |
| 12 | Thumbnails, CDN caching, ZIP download, audit log, rate limits |
| 13 | Playwright E2E, CI/CD, deploy to Cloudflare, seed prod demo data |
| 14 | README, diagrams, benchmarks, design review pass, final polish |

Do **not** start phase *n+1* while phase *n* has failing tests.

---

## 15. Acceptance Checklist (self-review before submitting)

- [ ] Admin registers, creates an event, adds two members — all from the UI.
- [ ] Member uploads 20 photos at once; one deliberately oversized file fails
      with a specific message and a working Retry; the other 19 succeed.
- [ ] Admin scrolls all 1 250 photos with no duplicates, no gaps, no jank.
- [ ] Performance panel on a throttled mobile profile: CLS 0 through a full
      scroll of the grid, no long task over 50 ms, and the network panel shows
      images arriving as you scroll — not 1 250 requests on load.
- [ ] Download-all on the 600-photo gallery completes without the Worker
      exceeding its memory limit, and Cloudflare's metrics prove it.
- [ ] Network tab shows cursor params — **zero** `offset=` anywhere, and no antd
      table anywhere renders a page-number pager.
- [ ] Admin selects 600, publishes, gets a URL + PIN, copies both.
- [ ] Customer opens the URL in a private window on a phone viewport, enters the
      PIN, browses all 600 with infinite scroll, opens the lightbox, downloads
      one photo and the full ZIP.
- [ ] Wrong PIN 5× → lockout with a countdown; correct PIN afterwards works.
- [ ] Member logs in and cannot see or reach the other event, cannot publish,
      cannot delete a teammate's photo — verified in the UI **and** with curl.
- [ ] Admin removes a member while that member is browsing; the member's very
      next action fails with a clear "you no longer have access" screen — no
      waiting for a token to expire.
- [ ] `document.cookie` in the console shows the `csrf` cookie but **not**
      `__Host-sid` — the session cookie is unreachable from JavaScript.
- [ ] `localStorage` holds a theme preference and **nothing about the user** —
      no id, no email, no role, no session.
- [ ] Admin rotates a gallery PIN; a customer already inside that gallery is
      locked out on their next scroll and the old PIN no longer works.
- [ ] `GET /auth/sessions` lists both browsers when logged in from two, and
      "sign out everywhere" ends the other one.
- [ ] An unpublished photo id fetched directly from the public API → 404.
- [ ] An expired gallery → 410 with a clean page.
- [ ] `pnpm test` green from a clean clone; Playwright green.
- [ ] CI green on `main`; production deploy is the commit that's tagged.
- [ ] `/docs` loads Swagger UI, a logged-in session authorizes it, and "Try it out" on
      `GET /events/{eventId}/photos` returns a real page with a real `nextCursor`
      that works when pasted back into the `cursor` field.
- [ ] `/redoc` loads, the sidebar is split into Team API and Customer API, and the
      "How to paginate" section renders with its curl loop.
- [ ] `docs/openapi.json` is committed and matches the deployed spec.
- [ ] `pnpm gen:api` produces no diff on a clean checkout, and deleting a field
      from a response schema breaks `tsc` in the frontend rather than at runtime.
- [ ] Toggling the theme switches both halves together, and a hard reload in
      dark mode never flashes light.
- [ ] Gallery bundle analysis shows **no antd** in the `/gallery/*` chunk; the
      gallery's initial JS + CSS is under 200 KB gzipped.
- [ ] Admin and gallery screenshotted side by side read as one company's work.
      Neither looks like stock antd or stock shadcn.
- [ ] README contains every section in §12 with working links and live creds.
- [ ] `git log -p | grep -iE 'secret|password|api[_-]?key'` finds nothing real.
- [ ] Lighthouse: performance ≥90, accessibility ≥95 on the public gallery.
- [ ] You can explain, out loud and without notes: the cursor codec, the
      authorization middleware, the upload presign flow, why `gallery_photos` is
      a snapshot, why antd's built-in pagination is disabled everywhere, why the
      two halves use different component kits, why you chose server-side sessions
      over JWTs, and why the auth store is the one Zustand store that isn't
      persisted.

---

## 16. Reference Implementations — the quality bar

These are the load-bearing pieces. Ship code of this standard or better; if you
deviate, it should be because you found something wrong here, and you should say
what. Every one of these is written to survive the three things that actually
break this product in production: **concurrent writes during pagination**,
**1 250 images hitting the network at once**, and **unbounded memory on bulk
download**.

### 16.1 Signed cursor codec — `packages/shared/src/cursor.ts`

```ts
import { z } from 'zod';

/**
 * A cursor is an opaque, HMAC-signed snapshot of one row's sort-key tuple.
 *
 * Signed, because an unsigned cursor is a client-controlled fragment of your
 * WHERE clause. Fingerprinted with the sort id, because a cursor minted under
 * `newest` replayed against `filename` would silently return a wrong page —
 * the single nastiest bug class in keyset pagination, and invisible in testing
 * unless you look for it.
 */
const Payload = z.object({
  v: z.literal(1),                                    // bump to invalidate old cursors
  k: z.array(z.union([z.string(), z.number(), z.null()])).min(1).max(4),
  d: z.enum(['next', 'prev']),
  s: z.string().min(1),                               // sort fingerprint, e.g. 'photos:newest'
});
export type CursorPayload = z.infer<typeof Payload>;

export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR' as const;
}

const te = new TextEncoder();
const td = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);   // payloads are <200 bytes
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Key import is ~0.1ms but happens on every request; cache per secret.
const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function encodeCursor(payload: CursorPayload, secret: string): Promise<string> {
  const body = b64urlEncode(te.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function decodeCursor(
  cursor: string,
  expectedSort: string,
  secret: string,
): Promise<CursorPayload> {
  const dot = cursor.indexOf('.');
  if (dot < 1) throw new InvalidCursorError('Malformed cursor');

  const body = cursor.slice(0, dot);
  const sig = cursor.slice(dot + 1);

  // crypto.subtle.verify is constant-time. Never hand-roll the comparison.
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), te.encode(body));
  } catch {
    throw new InvalidCursorError('Malformed cursor');
  }
  if (!ok) throw new InvalidCursorError('Cursor signature does not verify');

  const parsed = Payload.safeParse(JSON.parse(td.decode(b64urlDecode(body))));
  if (!parsed.success) throw new InvalidCursorError('Unsupported cursor version');

  // The guard that matters: a valid signature does not make a cursor valid HERE.
  if (parsed.data.s !== expectedSort) {
    throw new InvalidCursorError(
      `Cursor was issued for sort "${parsed.data.s}" but this request sorts by "${expectedSort}". Start from the first page.`,
    );
  }
  return parsed.data;
}
```

### 16.2 Generic keyset pagination — `apps/api/src/lib/keyset.ts`

One helper, used by every list endpoint. Nothing about photos in it.

```ts
import { and, asc, desc, sql, type SQL, type AnyColumn } from 'drizzle-orm';

export type SortKey = {
  column: AnyColumn;
  dir: 'asc' | 'desc';
  /** Nullable columns need an explicit null bucket or they break the keyset. */
  nullable?: boolean;
  /** Pull the key value out of a result row. */
  read: (row: any) => string | number | null;
};

export type SortSpec = { id: string; keys: SortKey[] };

/**
 * Sort specs live next to the schema so the composite index and the ORDER BY
 * can be reviewed together. The last key MUST be unique (the primary key) or
 * pagination will drop or repeat rows at page boundaries.
 */
export const photoSorts = {
  newest: {
    id: 'photos:newest',
    keys: [
      { column: photos.createdAt, dir: 'desc', read: (r) => r.createdAt },
      { column: photos.id, dir: 'desc', read: (r) => r.id },
    ],
  },
  taken: {
    id: 'photos:taken',
    keys: [
      { column: photos.takenAt, dir: 'desc', nullable: true, read: (r) => r.takenAt },
      { column: photos.id, dir: 'desc', read: (r) => r.id },
    ],
  },
  filename: {
    id: 'photos:filename',
    keys: [
      { column: photos.filename, dir: 'asc', read: (r) => r.filename },
      { column: photos.id, dir: 'asc', read: (r) => r.id },
    ],
  },
} satisfies Record<string, SortSpec>;

/**
 * ORDER BY, with nullability hoisted into an explicit leading key.
 *
 * SQLite's own null ordering differs between ASC and DESC, which would make the
 * keyset predicate direction-dependent for no good reason. Pinning it — nulls
 * last going forward, nulls first going backward — makes the null bucket just
 * another sort key, and makes `sort=taken` paginate like everything else.
 */
export function orderFor(spec: SortSpec, reverse: boolean): SQL[] {
  const out: SQL[] = [];
  for (const k of spec.keys) {
    const dir = reverse ? flip(k.dir) : k.dir;
    // `col IS NULL` is 0 or 1: ASC = non-nulls first (nulls last), DESC = nulls first.
    if (k.nullable) out.push(reverse ? desc(sql`${k.column} IS NULL`) : asc(sql`${k.column} IS NULL`));
    out.push(dir === 'asc' ? asc(k.column) : desc(k.column));
  }
  return out;
}

/**
 * Lexicographic keyset predicate:
 *   (k1 OP v1) OR (k1 = v1 AND ((k2 OP v2) OR (k2 = v2 AND ...)))
 *
 * When every key shares a direction and none is nullable we emit SQLite's row-value
 * form instead — `(a, b) < (?, ?)` — which lets the planner seek straight into the
 * composite index rather than evaluating a disjunction per row. Verify with
 * EXPLAIN QUERY PLAN; you want SEARCH, not SCAN.
 */
export function keysetPredicate(spec: SortSpec, values: (string | number | null)[], reverse: boolean): SQL {
  const keys = spec.keys;
  if (values.length !== keys.length) throw new InvalidCursorError('Cursor key arity mismatch');

  const uniform = keys.every((k) => k.dir === keys[0].dir) && keys.every((k) => !k.nullable);
  if (uniform) {
    const op = (keys[0].dir === 'desc') !== reverse ? sql`<` : sql`>`;
    const cols = sql.join(keys.map((k) => sql`${k.column}`), sql`, `);
    const vals = sql.join(values.map((v) => sql`${v}`), sql`, `);
    return sql`(${cols}) ${op} (${vals})`;
  }

  const build = (i: number): SQL => {
    const k = keys[i];
    const v = values[i];
    const dir = reverse ? flip(k.dir) : k.dir;
    // NULL comparisons are never true in SQL, so `strict` already excludes nulls.
    const strict = dir === 'asc' ? sql`${k.column} > ${v}` : sql`${k.column} < ${v}`;

    // Nulls sit in one bucket at the end (or, going backwards, at the start).
    // Forward from a real value: the nulls are still ahead of you.
    // Forward from inside the null bucket: nothing on this key follows.
    const nullsLast = !reverse;
    const after = !k.nullable
      ? strict
      : v === null
        ? (nullsLast ? sql`0` : sql`${k.column} IS NOT NULL`)
        : (nullsLast ? sql`(${strict} OR ${k.column} IS NULL)` : strict);

    const eq = k.nullable && v === null ? sql`${k.column} IS NULL` : sql`${k.column} = ${v}`;
    return i === keys.length - 1 ? after : sql`(${after} OR (${eq} AND ${build(i + 1)}))`;
  };
  return build(0);
}

const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc');
```

The endpoint, which is now boring — and should be:

```ts
export async function paginate<T>(opts: {
  db: DrizzleD1Database;
  spec: SortSpec;
  where: SQL;                      // tenancy + filters. NEVER from the cursor.
  select: (where: SQL, order: SQL[], limit: number) => Promise<T[]>;
  limit: number;
  cursor?: string;
  secret: string;
}): Promise<{ data: T[]; pageInfo: PageInfo }> {
  const { spec, limit, cursor, secret } = opts;

  const decoded = cursor ? await decodeCursor(cursor, spec.id, secret) : undefined;
  const reverse = decoded?.d === 'prev';

  const where = decoded
    ? and(opts.where, keysetPredicate(spec, decoded.k, reverse))!
    : opts.where;

  // limit + 1: one extra row tells us whether another page exists, without a
  // second query and without COUNT(*).
  const rows = await opts.select(where, orderFor(spec, reverse), limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // A 'prev' page is fetched backwards; the caller always gets display order.
  if (reverse) page.reverse();

  const keyOf = (row: T) => spec.keys.map((k) => k.read(row));
  const first = page[0];
  const last = page[page.length - 1];

  return {
    data: page,
    pageInfo: {
      nextCursor:
        page.length && (reverse ? true : hasMore)
          ? await encodeCursor({ v: 1, k: keyOf(last), d: 'next', s: spec.id }, secret)
          : null,
      prevCursor:
        page.length && (reverse ? hasMore : Boolean(decoded))
          ? await encodeCursor({ v: 1, k: keyOf(first), d: 'prev', s: spec.id }, secret)
          : null,
      hasNextPage: reverse ? true : hasMore,
      hasPrevPage: reverse ? hasMore : Boolean(decoded),
      limit,
    },
  };
}
```

Note what is *not* here: no `offset`, no `count`, no `page` number, and the
tenancy predicate is composed by the caller so a cursor can never widen it.

### 16.3 Bounded concurrency primitives — `packages/shared/src/async.ts`

Uploads, downloads, and the ZIP builder all need the same three things:
a cap on parallelism, retry that doesn't stampede, and cancellation that
actually cancels. Write them once.

```ts
/** Unordered worker pool. Use for uploads/downloads where order is irrelevant. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  opts: { signal?: AbortSignal; onSettled?: (done: number, total: number) => void } = {},
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      if (opts.signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i, opts.signal ?? neverAborts) };
      } catch (reason) {
        // One bad file must not fail the batch. The caller decides what a
        // partial success means — for an upload of 40 photos, 39 succeeded.
        results[i] = { status: 'rejected', reason };
      }
      opts.onSettled?.(++done, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Ordered bounded prefetch. Keeps `window` operations in flight but yields
 * strictly in input order — exactly what a ZIP stream needs: the entries must
 * be written in order, but fetching them one at a time wastes the whole
 * round-trip budget.
 */
export async function* prefetch<T, R>(
  items: Iterable<T>,
  window: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const it = items[Symbol.iterator]();
  // Settle eagerly: an in-flight rejection must not surface as an unhandled
  // rejection while we're awaiting an earlier entry.
  const queue: Promise<{ ok: true; v: R } | { ok: false; e: unknown }>[] = [];

  const pump = () => {
    const n = it.next();
    if (n.done) return false;
    queue.push(fn(n.value).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e })));
    return true;
  };

  while (queue.length < window && pump());
  while (queue.length) {
    const r = await queue.shift()!;
    pump();
    if (!r.ok) throw r.e;
    yield r.v;
  }
}

/** Retry with full jitter. Jitter, not fixed backoff — 40 files retrying in
 *  lockstep is a self-inflicted thundering herd. */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts?: number;
    baseMs?: number;
    capMs?: number;
    signal?: AbortSignal;
    isRetryable?: (e: unknown) => boolean;
  } = {},
): Promise<T> {
  const { attempts = 4, baseMs = 300, capMs = 8_000, signal, isRetryable = defaultRetryable } = opts;

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(signal ?? neverAborts);
    } catch (e) {
      if (attempt >= attempts - 1 || !isRetryable(e)) throw e;
      const delay = Math.random() * Math.min(capMs, baseMs * 2 ** attempt);
      await sleep(delay, signal);
    }
  }
}

const defaultRetryable = (e: unknown) =>
  e instanceof HttpError ? e.status === 408 || e.status === 429 || e.status >= 500 : e instanceof TypeError; // network

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

const neverAborts = new AbortController().signal;
```

### 16.4 Streaming ZIP with bounded prefetch — `apps/api/src/routes/gallery-download.ts`

The failure mode to design against: 600 photos × 5 MB is 3 GB. Buffer it and the
Worker dies. Fetch serially and the client waits on 600 sequential round trips.
The answer is a **sliding window** — a few objects in flight, entries written in
order, memory bounded by the window, not the gallery.

Do **not** hand-roll the ZIP container. `client-zip` already does streaming
store-only entries with data descriptors and Zip64, all of which you need and
none of which is where your judgment is worth spending. The interesting code is
the feed.

```ts
import { makeZip } from 'client-zip';

const PREFETCH_WINDOW = 4;   // ~4 objects resident: bounded memory, saturated link

app.post('/public/galleries/:slug/download-all', galleryAuth(), async (c) => {
  const gallery = c.get('gallery');
  if (!gallery.allowDownload) throw new ForbiddenError('DOWNLOAD_DISABLED');

  const bucket = c.env.BUCKET;

  // Walk the gallery in its curated order using the same keyset helper the API
  // uses — one D1 page at a time, so a 10 000-photo gallery costs no more
  // memory than a 60-photo one.
  async function* entries() {
    const pages = keysetWalk(c.env.DB, gallerySorts.curated, eq(galleryPhotos.galleryId, gallery.id), 200);

    for await (const photo of flatten(pages)) {
      yield { photo };
    }
  }

  async function* zipInput() {
    const fetchOne = async ({ photo }: { photo: Photo }) => {
      const obj = await bucket.get(photo.storageKey);
      if (!obj) return null;                       // deleted mid-download; skip, don't fail
      return { name: safeZipName(photo), input: obj.body!, lastModified: new Date(photo.createdAt) };
    };

    for await (const entry of prefetch(await collect(entries()), PREFETCH_WINDOW, fetchOne)) {
      if (entry) yield entry;
    }
  }

  return new Response(makeZip(zipInput()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${asciiFallback(gallery.title)}.zip"; filename*=UTF-8''${encodeURIComponent(gallery.title)}.zip`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** Filenames come from users. Collisions and traversal are both real here. */
function safeZipName(photo: Photo): string {
  const base = photo.filename.replace(/[/\\]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'photo';
  // Two cameras produce IMG_0001.JPG on the same day. Suffix with a short id.
  const dot = base.lastIndexOf('.');
  return dot > 0 ? `${base.slice(0, dot)}-${photo.id.slice(-6)}${base.slice(dot)}` : `${base}-${photo.id.slice(-6)}`;
}
```

Known limitation to write in the README rather than hide: no `Content-Length`,
because sizes aren't known until the stream ends, so the browser shows an
indeterminate progress bar. You *could* precompute it from `file_size` since
store-only entries have a deterministic overhead — say whether you did and why.

### 16.5 Lazy image loading — `apps/web/src/components/PhotoImage.tsx`

The naïve version — `<img loading="lazy">` on every tile — is not enough at this
scale: it still lays out 1 250 elements, still decodes on the main thread, and
still reflows as each image arrives. What follows is what actually holds 60 fps
on a mid-range phone.

```tsx
/**
 * One IntersectionObserver for the whole grid.
 *
 * Per-element observers are the common mistake: 1 250 observers is 1 250
 * pieces of observer state and a measurable amount of main-thread work on every
 * scroll frame. One shared observer, keyed by rootMargin, is O(1).
 */
const observers = new Map<string, IntersectionObserver>();
const callbacks = new WeakMap<Element, () => void>();

function observe(el: Element, rootMargin: string, onEnter: () => void): () => void {
  let io = observers.get(rootMargin);
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          callbacks.get(e.target)?.();
          io!.unobserve(e.target);            // one-shot: it never needs to fire again
          callbacks.delete(e.target);
        }
      },
      { rootMargin },
    );
    observers.set(rootMargin, io);
  }
  callbacks.set(el, onEnter);
  io.observe(el);
  return () => { io!.unobserve(el); callbacks.delete(el); };
}

type Props = {
  photo: Pick<Photo, 'id' | 'storageKey' | 'width' | 'height' | 'dominantColor' | 'filename'>;
  /** First screenful: skip the observer entirely and fetch at high priority. */
  priority?: boolean;
  sizes: string;
};

export function PhotoImage({ photo, priority = false, sizes }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [decoded, setDecoded] = useState(false);

  useEffect(() => {
    if (shouldLoad || !holder.current) return;
    // 400px of lead time: enough to be decoded before it scrolls in, not so much
    // that a fast flick downloads a hundred images the user never sees.
    return observe(holder.current, '400px 0px', () => setShouldLoad(true));
  }, [shouldLoad]);

  const src = `/img/thumb/${photo.storageKey}`;
  const srcSet = `/img/thumb/${photo.storageKey} 400w, /img/preview/${photo.storageKey} 1600w`;

  return (
    <div
      ref={holder}
      // Reserving the box from stored dimensions is what keeps CLS at zero.
      // Without it the grid reflows 1 250 times as images arrive.
      style={{
        aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '3 / 2',
        backgroundColor: photo.dominantColor ?? 'var(--color-surface-2)',
      }}
      className="relative overflow-hidden rounded-[--radius-tile]"
    >
      {shouldLoad && (
        <img
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={photo.filename}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          loading={priority ? 'eager' : 'lazy'}       // belt and braces with the observer
          decoding="async"                             // never block the main thread on decode
          fetchPriority={priority ? 'high' : 'auto'}
          // Fade from the dominant colour only once the bitmap is ready, so we
          // never paint a half-decoded image.
          onLoad={(e) => { void e.currentTarget.decode?.().catch(() => {}).finally(() => setDecoded(true)); }}
          onError={(e) => { e.currentTarget.dataset.failed = 'true'; setDecoded(true); }}
          className={`h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
            decoded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}
```

Rules this encodes, which you should be able to defend one by one:

- **Reserve the box before the bytes arrive.** `aspectRatio` from the stored
  `width`/`height` plus `dominant_color` as the ground. Zero layout shift, and
  the grid looks composed while it loads rather than like a progress bar.
- **`priority` for the first screenful.** Mark the first ~12 tiles eager and
  `fetchPriority="high"`; everything else waits for the observer. LCP is one of
  those first tiles.
- **Decode off the main thread**, and only reveal after `img.decode()` resolves.
- **One observer, one-shot.** Unobserve on first intersection.
- **`srcset` + `sizes`, not a single URL.** A 400 px thumb on a phone and a
  1600 px preview on a 5K display is the difference between a 40 KB and a 900 KB
  page, and Cloudflare Image Resizing already serves both.
- **Combine with TanStack Virtual, don't choose between them.** Virtualization
  keeps the DOM small; lazy loading keeps the network small. At 1 250 photos you
  need both — virtualization alone still requests every image in the rendered
  window on every fast scroll.

### 16.6 Infinite scroll wired to the cursor — `apps/web/src/features/photos/useGrid.ts`

```ts
export function usePhotoGrid(eventId: string, filters: PhotoFilters) {
  // Options come from the generated client (§16.8) — no URL, no fetch, no
  // hand-written types. Only the pagination policy is ours.
  const query = useInfiniteQuery({
    ...listEventPhotosInfiniteOptions({ path: { eventId }, query: filters }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    placeholderData: keepPreviousData,   // changing a filter must not flash empty
    staleTime: 30_000,
  });

  const photos = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    // Guarded: React 18 StrictMode double-invokes effects, and an unguarded
    // observer here fires two identical page fetches on mount.
    return observe(el, '600px 0px', () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    });
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return { photos, sentinel, ...query };
}
```

Optimistic selection that survives pagination — mutate the cached pages in
place, never refetch 1 250 rows to flip one boolean:

```ts
const select = useMutation({
  ...selectEventPhotosMutation(),        // generated
  onMutate: async (v) => {
    await qc.cancelQueries({ queryKey: ['photos', eventId] });
    const prev = qc.getQueriesData({ queryKey: ['photos', eventId] });
    const ids = new Set(v.photoIds);
    qc.setQueriesData({ queryKey: ['photos', eventId] }, (old: InfiniteData<PhotoPage> | undefined) =>
      old && {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          data: p.data.map((ph) => (ids.has(ph.id) ? { ...ph, isSelected: v.selected } : ph)),
        })),
      },
    );
    return { prev };
  },
  onError: (_e, _v, ctx) => ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)),
  onSettled: () => qc.invalidateQueries({ queryKey: ['events', eventId, 'stats'] }),
});
```

### 16.7 Batched client uploads — `apps/web/src/features/upload/uploadBatch.ts`

```ts
const UPLOAD_CONCURRENCY = 4;   // measured: 6+ starves the UI thread on mobile Safari

export async function uploadBatch(
  eventId: string,
  files: File[],
  { signal, onFileProgress, onFileSettled }: UploadCallbacks,
) {
  // Hash off the main thread. A 25 MB SHA-256 on the UI thread is a visible
  // freeze; in a worker it's invisible.
  const hashed = await mapPool(files, 2, (f) => hashInWorker(f, signal), { signal });

  // One intent call for the whole batch, not one per file: 40 files should cost
  // one round trip and one transaction, not 40 of each.
  const { uploads } = await api.uploadIntent(eventId, buildManifest(files, hashed));

  return mapPool(
    uploads,
    UPLOAD_CONCURRENCY,
    (u, i, sig) =>
      withRetry(
        (retrySignal) =>
          putToR2(u.uploadUrl, files[i], {
            signal: AbortSignal.any([sig, retrySignal]),
            onProgress: (loaded) => onFileProgress(u.photoId, loaded / files[i].size),
          }),
        { attempts: 4, signal: sig },
      ),
    { signal, onSettled: (done, total) => onFileSettled(done, total) },
  );
}

/** fetch() has no upload progress. XHR does. This is the one place it's worth it. */
function putToR2(url: string, file: File, o: { signal: AbortSignal; onProgress: (n: number) => void }) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress(e.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new HttpError(xhr.status, xhr.responseText)));
    xhr.onerror = () => reject(new TypeError('Network error'));
    xhr.ontimeout = () => reject(new HttpError(408, 'Upload timed out'));
    o.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
```

Then confirm in **one** call, and make it idempotent so a retried confirm after
a flaky response doesn't double-write.

### 16.8 Generated API client and client state — `packages/api-client`, `apps/web/src/stores`

**Nothing in `packages/api-client` is written by hand.** It is regenerated from
`docs/openapi.json` by `pnpm gen:api`, which runs in CI. A pull request that
changes a route and doesn't regenerate fails the build.

```ts
// openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './docs/openapi.json',          // committed, so the client builds with no server running
  output: {
    path: './packages/api-client/src',
    format: 'prettier',
    lint: 'eslint',
  },
  plugins: [
    { name: '@hey-api/client-fetch', runtimeConfigPath: './apps/web/src/lib/apiClient.ts' },
    '@hey-api/typescript',
    { name: '@hey-api/sdk', asClass: false },      // tree-shakeable functions, not a god object
    { name: 'zod', requests: true, responses: true },
    { name: '@tanstack/react-query', infiniteQueryOptions: true, mutationOptions: true },
  ],
});
```

Why generate the response Zod schemas too: the API's own validation protects the
database, but nothing protects the *client* from a deploy skew where the Worker
is a version ahead of the SPA. Parsing responses at the boundary turns that into
a clear error instead of `undefined is not an object` three components deep.
Enable it in development and on the gallery's PIN-unlock path; make it
opt-out for hot list endpoints if you measure a cost, and say which you chose.

**Cursor pagination through the generator.** The TanStack Query plugin emits
`*InfiniteOptions` for operations it recognises as paginated. Name the parameter
`cursor` and mark it explicitly in the route definition so detection isn't
guesswork:

```ts
query: PhotoListQuery.openapi({
  param: { 'x-pagination': true },     // hint for the generator
}),
```

Then **verify** rather than assume — `grep -c 'InfiniteOptions' packages/api-client/src/@tanstack/react-query.gen.ts`
is part of the generation script, and it fails loudly if the count drops. If the
generator can't be made to emit them, write the `infiniteQueryOptions` by hand
*on top of* the generated SDK functions, never by hand-rolling the fetch.

```ts
// consumption — no fetch, no URL, no manual types
const q = useInfiniteQuery({
  ...listEventPhotosInfiniteOptions({ path: { eventId }, query: filters }),
  getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  initialPageParam: undefined,
});
```

**Runtime config — where the session cookie and CSRF token get attached:**

```ts
// apps/web/src/lib/apiClient.ts — referenced by runtimeConfigPath above
import { createClient, createConfig } from '@hey-api/client-fetch';

export const client = createClient(
  createConfig({
    baseUrl: '/api/v1',
    // Same origin by deployment (§2), so the __Host-sid cookie rides along.
    // Stated explicitly because a future move to a separate API host would
    // silently drop auth otherwise.
    credentials: 'same-origin',
  }),
);

// Double-submit CSRF: the session cookie is HttpOnly and unreachable; the csrf
// cookie is deliberately readable, and echoing it proves the request came from
// our own page rather than a cross-site form post.
client.interceptors.request.use((request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const csrf = readCookie('csrf');
    if (csrf) request.headers.set('X-CSRF-Token', csrf);
  }
  return request;
});

// A 401 means the session is gone — revoked, expired, or signed out elsewhere.
// Clear local state once, centrally, instead of in forty components.
client.interceptors.response.use((response) => {
  if (response.status === 401 && !response.url.includes('/auth/')) {
    useAuthStore.getState().clear();
  }
  return response;
});
```

#### Zustand stores — and the one rule that keeps them small

**Server data lives in TanStack Query. Client state lives in Zustand. Never copy
one into the other.** A photo list in a Zustand store is a second cache you now
have to invalidate; that is how these codebases rot. Four stores, and you should
be able to justify each.

**`useAuthStore` — deliberately not persisted**

```ts
type AuthState = {
  status: 'unknown' | 'authed' | 'anon';
  user: Me | null;
  memberships: Membership[];
  setSession: (me: Me) => void;
  clear: () => void;
  roleIn: (eventId: string) => 'admin' | 'member' | null;
};

export const useAuthStore = create<AuthState>()(
  devtools(
    (set, get) => ({
      status: 'unknown',
      user: null,
      memberships: [],
      setSession: (me) => set({ status: 'authed', user: me.user, memberships: me.memberships }),
      clear: () => set({ status: 'anon', user: null, memberships: [] }),
      roleIn: (eventId) => get().memberships.find((m) => m.eventId === eventId)?.role ?? null,
    }),
    { name: 'auth' },
  ),
);
```

- **No `persist` middleware here, on purpose.** The session is an httpOnly
  cookie the browser owns. Mirroring identity into `localStorage` would put back
  exactly the XSS-reachable surface §2 removed by not using JWTs — and it would
  go stale the moment the session is revoked from another device. The store is a
  render-time cache of `/auth/me`, nothing more; on boot, TanStack Query fetches
  `/auth/me` and calls `setSession`. `status: 'unknown'` is the third state that
  stops the app flashing the login screen during that first request.
- `roleIn()` is for **rendering**, never for deciding. The server re-checks every
  request; this only decides whether to draw the Publish button.
- Route guards read `status` in `beforeLoad` and wait on the `/auth/me` query
  rather than redirecting from `'unknown'`.

**`useThemeStore` — persisted, and it drives both UI kits**

```ts
type ThemeState = {
  preference: 'system' | 'light' | 'dark';
  resolved: 'light' | 'dark';
  setPreference: (p: ThemeState['preference']) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      resolved: systemTheme(),
      setPreference: (preference) =>
        set({ preference, resolved: preference === 'system' ? systemTheme() : preference }),
    }),
    {
      name: 'theme',
      partialize: (s) => ({ preference: s.preference }),   // never persist derived state
      onRehydrateStorage: () => (s) => s && s.setPreference(s.preference),
    },
  ),
);

// The OS preference can change while the tab is open.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { preference, setPreference } = useThemeStore.getState();
  if (preference === 'system') setPreference('system');
});

// One subscription writes the attribute Tailwind's tokens key off.
useThemeStore.subscribe((s) => document.documentElement.setAttribute('data-theme', s.resolved));
```

Persisting a theme is fine — it is a preference, not a credential, and the
distinction between this store and the auth store is exactly the point.

Two things this must get right:

- **No flash of the wrong theme.** A blocking inline script in `index.html`
  reads the same `theme` key and sets `data-theme` before the first paint.
  Zustand hydrates afterwards and agrees with it. Read the key in *one* place —
  a shared constant — so the script and the store can't drift.
- **One theme, two kits.** The resolved value drives Tailwind's `data-theme`
  tokens *and* antd's algorithm, from the same source:

  ```tsx
  const resolved = useThemeStore((s) => s.resolved);   // selector: this component
  return (                                             // re-renders, not the tree
    <ConfigProvider
      theme={{
        algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: true,
        token: tokensFromTailwind(resolved),           // §1: one palette, both kits
      }}
    >
      {children}
    </ConfigProvider>
  );
  ```

**`useUploadStore`** — the upload tray must survive navigation (§8.1), so its
per-file progress, retry state, and `AbortController` handles live here rather
than in a component that unmounts. Progress updates are throttled to ~10 Hz
before they reach the store: forty files emitting `onprogress` at native rate
will re-render the tray hundreds of times a second otherwise.

**`useSelectionStore`** — a `Set<string>` of selected photo ids plus the anchor
for shift-click ranges. It lives outside Query because a selection spans pages
that have been fetched, evicted, and refetched, and because "select all matching
this filter" is a predicate, not a list of ids.

**Subscribe with selectors, always.** `useAuthStore((s) => s.user)`, never
`useAuthStore()`. The second form re-renders the component on every unrelated
field change, which in the photo grid means re-rendering 1 250 tiles because an
upload advanced by one percent. Use `useShallow` for object selections.

### 16.9 What "principal engineer" means in this codebase

Judged on the code, not the feature list:

- **Every boundary is typed once.** Zod schema in `packages/shared` → request
  validation, OpenAPI spec, and the frontend's types all derive from it.
- **Every unbounded thing has a bound.** Page size, concurrency, prefetch window,
  bulk-array length, file size, retry attempts. Name the number and say why.
- **Every async operation is cancellable.** An `AbortSignal` reaches the actual
  I/O call, not just the wrapper.
- **Errors carry a code and a fix.** No `throw new Error('failed')`.
- **The comment says *why*, never *what*.** `// one-shot: it never needs to fire
  again` earns its line; `// set state` does not.
- **The dangerous default is disabled loudly.** `pagination={false}` gets a
  comment saying why, because the next person will try to turn it back on.
- **Partial success is a first-class outcome.** 39 of 40 uploads succeeding is
  the normal case, not an error path.

---

## 17. Working Agreement

- Ask before inventing scope. Everything above is in scope; nothing else is.
- When a requirement is ambiguous, pick the option you can defend in a code
  review, implement it, and write down the reasoning in the README.
- Prefer boring, explicit code over clever abstraction. This gets read by a
  reviewer under time pressure.
- Write the test with the feature, not after the phase.
- Commit working increments. A broken `main` at any point is a failure.
