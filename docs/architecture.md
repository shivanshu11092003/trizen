# Architecture notes

The app is deployed on one origin. A Cloudflare Worker serves the React static assets
and owns `/api/*` and `/img/*`; API documentation is disabled in production. Keeping those paths on
one hostname is a security decision: the team session can stay in an httpOnly,
`SameSite=Strict`, `__Host-` cookie and no CORS policy exists to misconfigure.

```mermaid
flowchart LR
  B[Browser] --> E[Cloudflare edge]
  E --> W[Hono Worker + React assets]
  W --> D[(Supabase Postgres)]
  W --> R[(Private Supabase Storage)]
  R --> I[Supabase image transforms]
  I --> C[Edge cache]
```

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker
  participant R as Supabase Storage
  participant D as Supabase Postgres
  B->>W: POST upload-intent (metadata)
  W->>D: reserve pending rows
  W-->>B: signed Storage PUT URLs
  B->>R: PUT bytes directly (4 concurrent)
  B->>W: POST confirm
  W->>R: verify object exists, size and content type
  W->>D: pending → ready
```

```mermaid
sequenceDiagram
  participant C as Client
  participant W as Worker
  participant D as Supabase Postgres
  C->>W: POST gallery/unlock { PIN }
  W->>D: rate-limit + constant-time PIN check
  W->>D: create gallery session
  W-->>C: path-scoped httpOnly cookie
  C->>W: GET gallery photos + cursor
  W->>D: validate session + published snapshot
  W-->>C: ordered page + next cursor
```

## Pagination invariant

Every cursor is `base64url(JSON).base64url(HMAC-SHA-256)`. The signed JSON holds
only a version, key tuple, direction, and sort fingerprint. The event/member
predicate is owned by the handler and can never be widened by cursor input.
Forward queries fetch `limit + 1`; previous-page queries invert comparison and
ordering, then reverse the result before returning it.
