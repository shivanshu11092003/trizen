import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppBindings } from '../types.js';

/**
 * `__Host-` is browser-enforced: no Domain attribute, Path=/, Secure required.
 * A compromised subdomain cannot set it. Worth the awkward name.
 */
export const SESSION_COOKIE = '__Host-sid';
export const CSRF_COOKIE = 'csrf';

const isSecureContext = (c: Context<AppBindings>) => new URL(c.req.url).protocol === 'https:';

export function setSessionCookie(c: Context<AppBindings>, token: string, maxAgeSeconds: number): void {
  // The __Host- prefix requires Secure, which localhost over http cannot satisfy.
  // Fall back to a plain name in dev rather than silently setting nothing.
  const secure = isSecureContext(c);
  setCookie(c, secure ? SESSION_COOKIE : 'sid', token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    maxAge: maxAgeSeconds,
  });
}

export function readSessionCookie(c: Context<AppBindings>): string | undefined {
  return getCookie(c, SESSION_COOKIE) ?? getCookie(c, 'sid');
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  deleteCookie(c, 'sid', { path: '/' });
}

/** Deliberately readable by JavaScript: the double-submit token is meant to be
 *  echoed back in a header, which is exactly what a cross-site page cannot do. */
export function setCsrfCookie(c: Context<AppBindings>, token: string, maxAgeSeconds: number): void {
  setCookie(c, CSRF_COOKIE, token, {
    path: '/',
    httpOnly: false,
    secure: isSecureContext(c),
    sameSite: 'Strict',
    maxAge: maxAgeSeconds,
  });
}

export function clearCsrfCookie(c: Context<AppBindings>): void {
  deleteCookie(c, CSRF_COOKIE, { path: '/' });
}

/**
 * Gallery cookies are path-scoped to their own gallery, so the browser never
 * transmits gallery A's cookie on a request for gallery B. The handler checks
 * gallery_id anyway -- defence in depth means not trusting the browser to
 * enforce your authorization.
 */
export const galleryCookieName = (slug: string) => `gsid_${slug}`;
export const galleryCookiePath = (slug: string) => `/api/v1/public/galleries/${slug}`;

export function setGalleryCookie(c: Context<AppBindings>, slug: string, token: string, maxAge: number): void {
  setCookie(c, galleryCookieName(slug), token, {
    path: galleryCookiePath(slug),
    httpOnly: true,
    secure: isSecureContext(c),
    // Lax, not Strict: customers arrive by clicking a link from WhatsApp or
    // email, and Strict would drop the cookie on that first navigation.
    sameSite: 'Lax',
    maxAge,
  });
}

export function readGalleryCookie(c: Context<AppBindings>, slug: string): string | undefined {
  return getCookie(c, galleryCookieName(slug));
}

export function clearGalleryCookie(c: Context<AppBindings>, slug: string): void {
  deleteCookie(c, galleryCookieName(slug), { path: galleryCookiePath(slug) });
}
