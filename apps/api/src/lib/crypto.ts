import { b64url } from './ids.js';

// Cloudflare production caps PBKDF2 at 100,000 iterations. An independent
// server-side HMAC pepper also protects hashes if the database alone leaks.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const te = new TextEncoder();

function b64urlDecode(s: string): Uint8Array {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

async function pepperSecret(secret: string, pepper: string): Promise<string> {
  if (!pepper) throw new Error('PIN_PEPPER is required for password and PIN hashing.');
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(secret))));
}

/** Format: pbkdf2p$<iterations>$<salt>$<hash>; HMAC-SHA256 then salted PBKDF2-SHA256. */
export async function hashSecret(secret: string, pepper: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(await pepperSecret(secret, pepper), salt, PBKDF2_ITERATIONS);
  return `pbkdf2p$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifySecret(secret: string, stored: string, pepper: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2p') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100_000) return false;

  const salt = b64urlDecode(parts[2]!);
  const expected = b64urlDecode(parts[3]!);
  const actual = await derive(await pepperSecret(secret, pepper), salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** Constant-time comparison. Length is not secret; content is. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Peppered hash for values we must not store in the clear (IPs, user agents). */
export const hashWithPepper = (value: string, pepper: string): Promise<string> =>
  sha256Hex(`${value}:${pepper}`);
