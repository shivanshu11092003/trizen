import { bigint, boolean, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

const epoch = (name: string) => bigint(name, { mode: 'number' });

/**
 * Conventions used throughout:
 *  - ids are ULIDs: lexicographically sortable, so (created_at, id) keyset
 *    tie-breaks stay monotonic and index scans stay sequential.
 *  - timestamps are epoch milliseconds in PostgreSQL bigint columns. Keeping
 *    numbers at the API boundary preserves the existing cursor contract.
 *  - booleans use native PostgreSQL boolean columns.
 */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
}, (t) => ({
  emailUnique: uniqueIndex('idx_users_email').on(t.email),
}));

/**
 * Team sessions. Replaces any JWT/refresh-token scheme: a session is a row, so
 * revocation is a DELETE and takes effect on the very next request.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  csrfToken: text('csrf_token').notNull(),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  createdAt: epoch('created_at').notNull(),
  lastSeenAt: epoch('last_seen_at').notNull(),
  idleExpiresAt: epoch('idle_expires_at').notNull(),
  absoluteExpiresAt: epoch('absolute_expires_at').notNull(),
  revokedAt: epoch('revoked_at'),
}, (t) => ({
  tokenUnique: uniqueIndex('idx_sessions_token').on(t.tokenHash),
  byUser: index('idx_sessions_user').on(t.userId, t.lastSeenAt, t.id),
  sweep: index('idx_sessions_sweep').on(t.absoluteExpiresAt),
}));

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  eventDate: epoch('event_date'),
  ownerId: text('owner_id').notNull().references(() => users.id),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
}, (t) => ({
  byOwner: index('idx_events_owner_cursor').on(t.ownerId, t.createdAt, t.id),
}));

/** The authorization spine. Every access check is a join through this table. */
export const eventMembers = pgTable('event_members', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  addedBy: text('added_by').references(() => users.id),
  addedAt: epoch('added_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.eventId, t.userId] }),
  byUser: index('idx_members_user_cursor').on(t.userId, t.addedAt, t.eventId),
}));

/** Metadata only. The bytes live in a private Supabase Storage bucket. */
export const photos = pgTable('photos', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  filenameLower: text('filename_lower').notNull(), // search without a function index
  storageKey: text('storage_key').notNull(),
  thumbKey: text('thumb_key'),
  contentType: text('content_type').notNull(),
  fileSize: integer('file_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  dominantColor: text('dominant_color'),
  checksum: text('checksum'),
  caption: text('caption'),
  takenAt: epoch('taken_at'),
  status: text('status', { enum: ['pending', 'ready', 'failed', 'deleted'] }).notNull().default('pending'),
  isSelected: boolean('is_selected').notNull().default(false),
  deletedAt: epoch('deleted_at'),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
}, (t) => ({
  storageKeyUnique: uniqueIndex('idx_photos_storage_key').on(t.storageKey),
  // THE pagination index: column order matches the ORDER BY exactly.
  eventCursor: index('idx_photos_event_cursor').on(t.eventId, t.status, t.createdAt, t.id),
  uploaderCursor: index('idx_photos_uploader_cursor').on(t.eventId, t.uploadedBy, t.createdAt, t.id),
  selectedCursor: index('idx_photos_selected').on(t.eventId, t.isSelected, t.createdAt, t.id),
  takenCursor: index('idx_photos_taken_cursor').on(t.eventId, t.takenAt, t.id),
  filenameCursor: index('idx_photos_filename_cursor').on(t.eventId, t.filenameLower, t.id),
  sizeCursor: index('idx_photos_size_cursor').on(t.eventId, t.fileSize, t.id),
  dedupe: uniqueIndex('idx_photos_dedupe').on(t.eventId, t.checksum),
}));

export const galleries = pgTable('galleries', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  coverPhotoId: text('cover_photo_id'),
  pinHash: text('pin_hash').notNull(),
  pinSetAt: epoch('pin_set_at').notNull(),
  status: text('status', { enum: ['draft', 'published', 'unpublished'] }).notNull().default('draft'),
  publishedAt: epoch('published_at'),
  expiresAt: epoch('expires_at'),
  allowDownload: boolean('allow_download').notNull().default(true),
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: epoch('last_viewed_at'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
}, (t) => ({
  slugUnique: uniqueIndex('idx_galleries_slug').on(t.slug),
  byEvent: index('idx_galleries_event').on(t.eventId, t.createdAt, t.id),
}));

/**
 * An immutable snapshot of what was published -- deliberately NOT a live view of
 * photos.is_selected. Unselecting a photo after publishing must not silently
 * change what the client already bookmarked.
 */
export const galleryPhotos = pgTable('gallery_photos', {
  galleryId: text('gallery_id').notNull().references(() => galleries.id, { onDelete: 'cascade' }),
  photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  addedAt: epoch('added_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.galleryId, t.photoId] }),
  cursor: index('idx_gallery_photos_cursor').on(t.galleryId, t.sortOrder, t.photoId),
}));

/** Created by a correct PIN. Path-scoped cookie; revoked in bulk on PIN rotate. */
export const gallerySessions = pgTable('gallery_sessions', {
  id: text('id').primaryKey(),
  galleryId: text('gallery_id').notNull().references(() => galleries.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  ipHash: text('ip_hash'),
  userAgentHash: text('user_agent_hash'),
  createdAt: epoch('created_at').notNull(),
  lastSeenAt: epoch('last_seen_at').notNull(),
  idleExpiresAt: epoch('idle_expires_at').notNull(),
  absoluteExpiresAt: epoch('absolute_expires_at').notNull(),
  revokedAt: epoch('revoked_at'),
}, (t) => ({
  tokenUnique: uniqueIndex('idx_gsessions_token').on(t.tokenHash),
  byGallery: index('idx_gsessions_gallery').on(t.galleryId, t.createdAt, t.id),
  sweep: index('idx_gsessions_sweep').on(t.absoluteExpiresAt),
}));

export const pinAttempts = pgTable('pin_attempts', {
  id: text('id').primaryKey(),
  galleryId: text('gallery_id').notNull().references(() => galleries.id, { onDelete: 'cascade' }),
  ipHash: text('ip_hash').notNull(), // never the raw IP
  success: boolean('success').notNull(),
  attemptedAt: epoch('attempted_at').notNull(),
}, (t) => ({
  lookup: index('idx_pin_attempts').on(t.galleryId, t.ipHash, t.attemptedAt),
}));

export const inviteTokens = pgTable('invite_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  email: text('email').notNull(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  invitedBy: text('invited_by').notNull().references(() => users.id),
  expiresAt: epoch('expires_at').notNull(),
  acceptedAt: epoch('accepted_at'),
  createdAt: epoch('created_at').notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex('idx_invites_token').on(t.tokenHash),
}));

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').references(() => users.id),
  eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: text('metadata'),
  createdAt: epoch('created_at').notNull(),
}, (t) => ({
  cursor: index('idx_audit_cursor').on(t.eventId, t.createdAt, t.id),
}));

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: epoch('window_start').notNull(),
  count: integer('count').notNull(),
}, (t) => ({
  sweep: index('idx_rate_limits_sweep').on(t.windowStart),
}));
