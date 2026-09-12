import type { Database } from './services/database.js';

export type Env = {
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;

  DOCS_ENABLED: string;
  PUBLIC_ORIGIN: string;

  CURSOR_SECRET: string;
  PIN_PEPPER: string;
  IP_HASH_PEPPER: string;

};

export type SessionPrincipal = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  csrfToken: string;
};

export type GalleryPrincipal = {
  gallerySessionId: string;
  galleryId: string;
  slug: string;
  allowDownload: boolean;
};

export type Variables = {
  db: Database;
  requestId: string;
  session?: SessionPrincipal;
  gallery?: GalleryPrincipal;
  eventRole?: 'admin' | 'member';
};

export type AppBindings = { Bindings: Env; Variables: Variables };
