import {
  deleteApiV1EventsByEventIdMembersByUserId,
  getApiV1AuthMe,
  getApiV1Events,
  getApiV1EventsByEventId,
  getApiV1EventsByEventIdGalleries,
  getApiV1EventsByEventIdMembers,
  getApiV1EventsByEventIdPhotos,
  getApiV1EventsByEventIdStats,
  getApiV1PublicGalleriesBySlug,
  getApiV1PublicGalleriesBySlugPhotos,
  postApiV1AuthLogin,
  postApiV1AuthLogout,
  postApiV1AuthRegister,
  postApiV1Events,
  postApiV1EventsByEventIdGalleries,
  postApiV1EventsByEventIdMembers,
  postApiV1EventsByEventIdPhotosConfirm,
  postApiV1EventsByEventIdPhotosSelect,
  postApiV1EventsByEventIdPhotosUploadIntent,
  postApiV1PublicGalleriesBySlugUnlock,
} from '@photos/api-client';
import { client } from '@photos/api-client/client';
import type { EventItem, EventMember, EventStats, Gallery, Me, Page, Photo } from '../types';

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

client.setConfig({ baseUrl: '', credentials: 'same-origin' });
client.interceptors.request.use((request) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    const csrf = readCookie('csrf');
    if (csrf) request.headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  return request;
});

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };
async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (result.error || !result.response.ok) {
    const error = result.error as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(result.response.status, error?.error?.code ?? 'INTERNAL', error?.error?.message ?? 'Request failed.');
  }
  return result.data as T;
}

export const api = {
  me: () => unwrap<Me>(getApiV1AuthMe()),
  login: (email: string, password: string) => unwrap<Me>(postApiV1AuthLogin({ body: { email, password } })),
  register: (email: string, password: string, displayName: string) => unwrap<Me>(postApiV1AuthRegister({ body: { email, password, displayName } })),
  logout: () => unwrap<void>(postApiV1AuthLogout()),
  events: (cursor?: string) => unwrap<Page<EventItem>>(getApiV1Events({ query: { limit: 24, cursor } })),
  event: (eventId: string) => unwrap<EventItem>(getApiV1EventsByEventId({ path: { eventId } })),
  createEvent: (body: { name: string; description?: string; eventDate?: number }) => unwrap<EventItem>(postApiV1Events({ body })),
  stats: (eventId: string) => unwrap<EventStats>(getApiV1EventsByEventIdStats({ path: { eventId } })),
  photos: (eventId: string, options: Record<string, string | number | boolean | undefined>) => unwrap<Page<Photo>>(getApiV1EventsByEventIdPhotos({ path: { eventId }, query: { limit: 48, ...options } } as never)),
  selectPhotos: (eventId: string, photoIds: string[], selected: boolean) => unwrap<{ updated: number }>(postApiV1EventsByEventIdPhotosSelect({ path: { eventId }, body: { photoIds, selected } })),
  members: (eventId: string, cursor?: string) => unwrap<Page<EventMember>>(getApiV1EventsByEventIdMembers({ path: { eventId }, query: { limit: 50, cursor } })),
  addMember: (eventId: string, body: { email: string; role: 'admin' | 'member'; displayName?: string }) => unwrap<EventMember & { temporaryPassword?: string }>(postApiV1EventsByEventIdMembers({ path: { eventId }, body })),
  removeMember: (eventId: string, userId: string) => unwrap<void>(deleteApiV1EventsByEventIdMembersByUserId({ path: { eventId, userId } })),
  galleries: (eventId: string, cursor?: string) => unwrap<Page<Gallery>>(getApiV1EventsByEventIdGalleries({ path: { eventId }, query: { limit: 50, cursor } })),
  createGallery: (eventId: string, body: unknown) => unwrap<{ gallery: Gallery; url: string; pin: string }>(postApiV1EventsByEventIdGalleries({ path: { eventId }, body } as never)),
  teaser: (slug: string) => unwrap<{ title: string; photoCount: number; allowDownload: boolean; expiresAt: number | null; unlocked: boolean }>(getApiV1PublicGalleriesBySlug({ path: { slug } })),
  unlock: (slug: string, pin: string) => unwrap<void>(postApiV1PublicGalleriesBySlugUnlock({ path: { slug }, body: { pin } })),
  galleryPhotos: (slug: string, cursor?: string) => unwrap<Page<Photo>>(getApiV1PublicGalleriesBySlugPhotos({ path: { slug }, query: { limit: 48, cursor } })),
  uploadIntent: (eventId: string, files: { filename: string; contentType: string; fileSize: number }[]) => unwrap<{ uploads: { photoId: string; filename: string; uploadUrl: string }[] }>(postApiV1EventsByEventIdPhotosUploadIntent({ path: { eventId }, body: { files } } as never)),
  confirmUpload: (eventId: string, items: { photoId: string; width?: number; height?: number }[]) => unwrap(postApiV1EventsByEventIdPhotosConfirm({ path: { eventId }, body: { items } })),
};
