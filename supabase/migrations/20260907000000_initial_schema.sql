-- Arc & Grain application schema for Supabase Postgres.
-- The Hono API uses the service role; browser clients never query these tables directly.

create table public.users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  is_platform_admin boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create table public.sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  user_agent text,
  ip_hash text,
  created_at bigint not null,
  last_seen_at bigint not null,
  idle_expires_at bigint not null,
  absolute_expires_at bigint not null,
  revoked_at bigint
);

create table public.events (
  id text primary key,
  name text not null,
  description text,
  event_date bigint,
  owner_id text not null references public.users(id),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at bigint not null,
  updated_at bigint not null
);

create table public.event_members (
  event_id text not null references public.events(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  added_by text references public.users(id),
  added_at bigint not null,
  primary key (event_id, user_id)
);

create table public.photos (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  uploaded_by text not null references public.users(id),
  filename text not null,
  filename_lower text not null,
  storage_key text not null unique,
  thumb_key text,
  content_type text not null,
  file_size integer not null,
  width integer,
  height integer,
  dominant_color text,
  checksum text,
  caption text,
  taken_at bigint,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'deleted')),
  is_selected boolean not null default false,
  deleted_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  unique (event_id, checksum)
);

create table public.galleries (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  slug text not null unique,
  title text not null,
  cover_photo_id text,
  pin_hash text not null,
  pin_set_at bigint not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  published_at bigint,
  expires_at bigint,
  allow_download boolean not null default true,
  view_count integer not null default 0,
  last_viewed_at bigint,
  created_by text not null references public.users(id),
  created_at bigint not null,
  updated_at bigint not null
);

create table public.gallery_photos (
  gallery_id text not null references public.galleries(id) on delete cascade,
  photo_id text not null references public.photos(id) on delete cascade,
  sort_order integer not null,
  added_at bigint not null,
  primary key (gallery_id, photo_id)
);

create table public.gallery_sessions (
  id text primary key,
  gallery_id text not null references public.galleries(id) on delete cascade,
  token_hash text not null unique,
  ip_hash text,
  user_agent_hash text,
  created_at bigint not null,
  last_seen_at bigint not null,
  idle_expires_at bigint not null,
  absolute_expires_at bigint not null,
  revoked_at bigint
);

create table public.pin_attempts (
  id text primary key,
  gallery_id text not null references public.galleries(id) on delete cascade,
  ip_hash text not null,
  success boolean not null,
  attempted_at bigint not null
);

create table public.invite_tokens (
  id text primary key,
  token_hash text not null unique,
  email text not null,
  event_id text not null references public.events(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  invited_by text not null references public.users(id),
  expires_at bigint not null,
  accepted_at bigint,
  created_at bigint not null
);

create table public.audit_log (
  id text primary key,
  actor_id text references public.users(id),
  event_id text references public.events(id) on delete cascade,
  action text not null,
  target_type text,
  target_id text,
  metadata text,
  created_at bigint not null
);

create table public.rate_limits (
  key text primary key,
  window_start bigint not null,
  count integer not null
);

create index idx_sessions_user on public.sessions(user_id, last_seen_at, id);
create index idx_sessions_sweep on public.sessions(absolute_expires_at);
create index idx_events_owner_cursor on public.events(owner_id, created_at, id);
create index idx_members_user_cursor on public.event_members(user_id, added_at, event_id);
create index idx_photos_event_cursor on public.photos(event_id, status, created_at, id);
create index idx_photos_uploader_cursor on public.photos(event_id, uploaded_by, created_at, id);
create index idx_photos_selected on public.photos(event_id, is_selected, created_at, id);
create index idx_photos_taken_cursor on public.photos(event_id, taken_at, id);
create index idx_photos_filename_cursor on public.photos(event_id, filename_lower, id);
create index idx_photos_size_cursor on public.photos(event_id, file_size, id);
create index idx_galleries_event on public.galleries(event_id, created_at, id);
create index idx_gallery_photos_cursor on public.gallery_photos(gallery_id, sort_order, photo_id);
create index idx_gsessions_gallery on public.gallery_sessions(gallery_id, created_at, id);
create index idx_gsessions_sweep on public.gallery_sessions(absolute_expires_at);
create index idx_pin_attempts on public.pin_attempts(gallery_id, ip_hash, attempted_at);
create index idx_audit_cursor on public.audit_log(event_id, created_at, id);
create index idx_rate_limits_sweep on public.rate_limits(window_start);

-- Defense in depth: only the backend service-role client may access app tables.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.photos enable row level security;
alter table public.galleries enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.gallery_sessions enable row level security;
alter table public.pin_attempts enable row level security;
alter table public.invite_tokens enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos-originals',
  'photos-originals',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
