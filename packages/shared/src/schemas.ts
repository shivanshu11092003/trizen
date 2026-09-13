import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Not a ULID');
export const Email = z.string().email().max(254).toLowerCase();
export const Password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Passwords are capped at 200 characters');

export const Role = z.enum(['admin', 'member']);
export type Role = z.infer<typeof Role>;

export const PhotoStatus = z.enum(['pending', 'ready', 'failed', 'deleted']);
export const GalleryStatus = z.enum(['draft', 'published', 'unpublished']);

/** The one envelope every list endpoint returns. No totals, no page numbers. */
export const PageInfo = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
  limit: z.number().int(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const page = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), pageInfo: PageInfo });

/** Shared by every list endpoint. `sort` is narrowed per-endpoint. */
export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(512).optional(),
});

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string(),
  }),
});

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export const RegisterBody = z.object({
  email: Email,
  password: Password,
  displayName: z.string().trim().min(1).max(80),
});

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });

export const PublicUser = z.object({
  id: Ulid,
  email: z.string(),
  displayName: z.string(),
  isPlatformAdmin: z.boolean(),
  createdAt: z.number().int(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const Membership = z.object({ eventId: Ulid, eventName: z.string(), role: Role });

export const Me = z.object({
  user: PublicUser,
  memberships: z.array(Membership),
  csrfToken: z.string(),
  sessionId: Ulid,
});
export type Me = z.infer<typeof Me>;

export const SessionSummary = z.object({
  id: Ulid,
  current: z.boolean(),
  userAgent: z.string().nullable(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
  idleExpiresAt: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * Events & members
 * ------------------------------------------------------------------ */

export const CreateEventBody = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional(),
  eventDate: z.number().int().optional(),
});

export const Event = z.object({
  id: Ulid,
  name: z.string(),
  description: z.string().nullable(),
  eventDate: z.number().int().nullable(),
  ownerId: Ulid,
  status: z.enum(['active', 'archived']),
  role: Role,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Event = z.infer<typeof Event>;

export const EventStats = z.object({
  totalPhotos: z.number().int(),
  readyPhotos: z.number().int(),
  selectedPhotos: z.number().int(),
  storageBytes: z.number().int(),
  galleries: z.number().int(),
  uploaders: z.array(z.object({ userId: Ulid, displayName: z.string(), count: z.number().int() })),
});

export const AddMemberBody = z.object({ email: Email, role: Role, displayName: z.string().max(80).optional() });

export const EventMember = z.object({
  userId: Ulid,
  email: z.string(),
  displayName: z.string(),
  role: Role,
  addedAt: z.number().int(),
  photoCount: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * Photos
 * ------------------------------------------------------------------ */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export const Photo = z.object({
  id: Ulid,
  eventId: Ulid,
  uploadedBy: Ulid,
  uploaderName: z.string().optional(),
  filename: z.string(),
  storageKey: z.string(),
  contentType: z.string(),
  fileSize: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  dominantColor: z.string().nullable(),
  caption: z.string().nullable(),
  takenAt: z.number().int().nullable(),
  status: PhotoStatus,
  isSelected: z.boolean(),
  createdAt: z.number().int(),
});
export type Photo = z.infer<typeof Photo>;

export const PhotoSort = z.enum(['newest', 'oldest', 'filename', 'size', 'taken']);
export type PhotoSort = z.infer<typeof PhotoSort>;

export const PhotoListQuery = PaginationQuery.extend({
  sort: PhotoSort.default('newest'),
  search: z.string().trim().max(120).optional(),
  uploaderId: Ulid.optional(),
  selected: z.enum(['true', 'false']).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});
export type PhotoListQuery = z.infer<typeof PhotoListQuery>;

export const UploadIntentBody = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        contentType: z.enum(ALLOWED_MIME),
        fileSize: z.number().int().min(1).max(MAX_FILE_BYTES),
        checksum: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const UploadIntentResponse = z.object({
  uploads: z.array(
    z.object({
      photoId: Ulid,
      filename: z.string(),
      uploadUrl: z.string(),
      storageKey: z.string(),
      expiresAt: z.number().int(),
    }),
  ),
  duplicates: z.array(z.object({ filename: z.string(), existingPhotoId: Ulid })),
});

export const ConfirmUploadBody = z.object({
  items: z
    .array(
      z.object({
        photoId: Ulid,
        width: z.number().int().positive().max(60000).optional(),
        height: z.number().int().positive().max(60000).optional(),
        takenAt: z.number().int().optional(),
        dominantColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const SelectPhotosBody = z.object({
  photoIds: z.array(Ulid).min(1).max(500),
  selected: z.boolean(),
});

export const PatchPhotoBody = z.object({
  caption: z.string().trim().max(500).nullable().optional(),
  isSelected: z.boolean().optional(),
});

/* ------------------------------------------------------------------ *
 * Galleries
 * ------------------------------------------------------------------ */

export const CreateGalleryBody = z
  .object({
    title: z.string().trim().min(1).max(140),
    photoIds: z.array(Ulid).max(2000).optional(),
    useSelected: z.boolean().optional(),
    expiresAt: z.number().int().optional(),
    allowDownload: z.boolean().default(true),
    publish: z.boolean().default(false),
    pin: z.string().regex(/^\d{6}$/, 'The PIN is six digits').optional(),
  })
  .refine((v) => v.useSelected || (v.photoIds && v.photoIds.length > 0), {
    message: 'Choose photos, or set useSelected to publish the current selection',
    path: ['photoIds'],
  });

export const Gallery = z.object({
  id: Ulid,
  eventId: Ulid,
  slug: z.string(),
  title: z.string(),
  status: GalleryStatus,
  photoCount: z.number().int(),
  allowDownload: z.boolean(),
  expiresAt: z.number().int().nullable(),
  publishedAt: z.number().int().nullable(),
  viewCount: z.number().int(),
  lastViewedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type Gallery = z.infer<typeof Gallery>;

/** The PIN appears in exactly one response, once, and is never readable again. */
export const GalleryCredentials = z.object({ gallery: Gallery, url: z.string(), pin: z.string() });

export const PatchGalleryBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  expiresAt: z.number().int().nullable().optional(),
  allowDownload: z.boolean().optional(),
  coverPhotoId: Ulid.nullable().optional(),
});

/* ------------------------------------------------------------------ *
 * Public gallery
 * ------------------------------------------------------------------ */

export const GalleryTeaser = z.object({
  title: z.string(),
  photoCount: z.number().int(),
  coverThumbUrl: z.string().nullable(),
  allowDownload: z.boolean(),
  expiresAt: z.number().int().nullable(),
  unlocked: z.boolean(),
});

export const UnlockBody = z.object({ pin: z.string().regex(/^\d{6}$/, 'The PIN is six digits') });

export const PublicPhoto = z.object({
  id: Ulid,
  storageKey: z.string(),
  filename: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  dominantColor: z.string().nullable(),
  caption: z.string().nullable(),
  takenAt: z.number().int().nullable(),
});
export type PublicPhoto = z.infer<typeof PublicPhoto>;

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

export const AuditEntry = z.object({
  id: Ulid,
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.number().int(),
});
