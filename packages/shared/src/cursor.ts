import { z } from 'zod';
import { InvalidCursorError } from './errors.js';

/**
 * A cursor is an opaque, HMAC-signed snapshot of one row's sort-key tuple.
 *
 * Signed, because an unsigned cursor is a client-controlled fragment of your
 * WHERE clause. Fingerprinted with the sort id, because a cursor minted under
 * `newest` replayed against `filename` would silently return a wrong page --
 * the nastiest bug class in keyset pagination, and invisible unless you look.
 */
const Payload = z.object({
  v: z.literal(1),
  k: z.array(z.union([z.string(), z.number(), z.null()])).min(1).max(4),
  d: z.enum(['next', 'prev']),
  s: z.string().min(1),
});

export type CursorPayload = z.infer<typeof Payload>;

const te = new TextEncoder();
const td = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b); // payloads are < 200 bytes
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Key import is ~0.1ms but happens on every request; cache per secret.
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function encodeCursor(payload: CursorPayload, secret: string): Promise<string> {
  const body = b64urlEncode(te.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function decodeCursor(
  cursor: string,
  expectedSort: string,
  secret: string,
): Promise<CursorPayload> {
  const dot = cursor.indexOf('.');
  if (dot < 1 || dot === cursor.length - 1) throw new InvalidCursorError('Malformed cursor.');

  const body = cursor.slice(0, dot);
  const sig = cursor.slice(dot + 1);

  // crypto.subtle.verify is constant-time. Never hand-roll the comparison.
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      new Uint8Array(b64urlDecode(sig)),
      te.encode(body),
    );
  } catch {
    throw new InvalidCursorError('Malformed cursor.');
  }
  if (!ok) throw new InvalidCursorError('Cursor signature does not verify.');

  let json: unknown;
  try {
    json = JSON.parse(td.decode(b64urlDecode(body)));
  } catch {
    throw new InvalidCursorError('Malformed cursor.');
  }

  const parsed = Payload.safeParse(json);
  if (!parsed.success) throw new InvalidCursorError('Unsupported cursor version.');

  // A valid signature does not make a cursor valid HERE.
  if (parsed.data.s !== expectedSort) {
    throw new InvalidCursorError(
      `This cursor was issued for a different sort order (${parsed.data.s}). Start from the first page.`,
    );
  }
  return parsed.data;
}
