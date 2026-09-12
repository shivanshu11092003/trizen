/**
 * ULID: 48-bit timestamp + 80 bits of randomness, Crockford base32.
 * Lexicographically sortable, so (created_at, id) keyset tie-breaks stay
 * monotonic and the composite index scans sequentially.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[now % 32]! + out;
    now = Math.floor(now / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
  let out = '';
  for (const b of bytes) out += ENCODING[b % 32]!;
  return out;
}

export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** URL-safe, unguessable gallery slug: 16 chars of base32 = 80 bits. */
export function gallerySlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += ENCODING[b % 32]!;
  return out.toLowerCase();
}

/** Opaque session token: 32 bytes, base64url. Never stored; only its hash is. */
export function sessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Uniform 6-digit PIN. Rejection sampling, so 000000-999999 are equally likely. */
export function generatePin(): string {
  for (;;) {
    const v = crypto.getRandomValues(new Uint32Array(1))[0]!;
    // 4294967295 % 1000000 != 0, so the tail would bias low PINs. Discard it.
    if (v < 4_294_000_000) return String(v % 1_000_000).padStart(6, '0');
  }
}
