export type Role = 'admin' | 'member';

export type Membership = { eventId: string; eventName: string; role: Role };
export type User = { id: string; email: string; displayName: string; isPlatformAdmin: boolean; createdAt: number };
export type Me = { user: User; memberships: Membership[]; csrfToken: string; sessionId: string };

export type PageInfo = {
  nextCursor: string | null;
  prevCursor: string | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
};
export type Page<T> = { data: T[]; pageInfo: PageInfo };

export type EventItem = {
  id: string;
  name: string;
  description: string | null;
  eventDate: number | null;
  role: Role;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  ownerId: string;
};

export type EventStats = {
  totalPhotos: number;
  readyPhotos: number;
  selectedPhotos: number;
  storageBytes: number;
  galleries: number;
  uploaders: { userId: string; displayName: string; count: number }[];
};

export type Photo = {
  id: string;
  eventId: string;
  uploadedBy: string;
  uploaderName?: string;
  filename: string;
  storageKey: string;
  contentType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  caption: string | null;
  takenAt: number | null;
  status: 'pending' | 'ready' | 'failed' | 'deleted';
  isSelected: boolean;
  createdAt: number;
};

export type Gallery = {
  id: string;
  eventId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'unpublished';
  photoCount: number;
  allowDownload: boolean;
  expiresAt: number | null;
  publishedAt: number | null;
  viewCount: number;
  lastViewedAt: number | null;
  createdAt: number;
};

export type EventMember = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  addedAt: number;
  photoCount: number;
};
