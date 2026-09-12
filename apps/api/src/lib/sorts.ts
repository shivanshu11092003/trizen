import { galleryPhotos, photos } from '../db/schema.js';
import type { SortSpec } from './keyset.js';

/**
 * Sort specs live next to the schema so the composite index and the ORDER BY
 * can be reviewed together. The last key MUST be unique (the primary key) or
 * pagination will drop or repeat rows at page boundaries.
 */

export type PhotoRow = {
  id: string;
  createdAt: number;
  filenameLower: string;
  fileSize: number;
  takenAt: number | null;
};

export const photoSorts = {
  newest: {
    id: 'photos:newest',
    keys: [
      { column: photos.createdAt, dir: 'desc', read: (r) => r.createdAt },
      { column: photos.id, dir: 'desc', read: (r) => r.id },
    ],
  },
  oldest: {
    id: 'photos:oldest',
    keys: [
      { column: photos.createdAt, dir: 'asc', read: (r) => r.createdAt },
      { column: photos.id, dir: 'asc', read: (r) => r.id },
    ],
  },
  filename: {
    id: 'photos:filename',
    keys: [
      { column: photos.filenameLower, dir: 'asc', read: (r) => r.filenameLower },
      { column: photos.id, dir: 'asc', read: (r) => r.id },
    ],
  },
  size: {
    id: 'photos:size',
    keys: [
      { column: photos.fileSize, dir: 'desc', read: (r) => r.fileSize },
      { column: photos.id, dir: 'desc', read: (r) => r.id },
    ],
  },
  // takenAt is nullable: photos with no EXIF must still paginate, so the null
  // bucket is hoisted into its own leading sort key. See keyset.orderFor.
  taken: {
    id: 'photos:taken',
    keys: [
      { column: photos.takenAt, dir: 'desc', nullable: true, read: (r) => r.takenAt },
      { column: photos.id, dir: 'desc', read: (r) => r.id },
    ],
  },
} satisfies Record<string, SortSpec<PhotoRow>>;

export type GalleryPhotoRow = { photoId: string; sortOrder: number };

export const gallerySorts = {
  curated: {
    id: 'gallery:curated',
    keys: [
      { column: galleryPhotos.sortOrder, dir: 'asc', read: (r) => r.sortOrder },
      { column: galleryPhotos.photoId, dir: 'asc', read: (r) => r.photoId },
    ],
  },
} satisfies Record<string, SortSpec<GalleryPhotoRow>>;
