import { describe, expect, it } from 'vitest';
import { gallerySlug, generatePin, sessionToken, ulid } from '../src/lib/ids.js';
import { hashSecret, sha256Hex, verifySecret } from '../src/lib/crypto.js';

describe('security primitives', () => {
  it('stores verifiable PBKDF2 hashes without the source secret', async () => {
    const stored = await hashSecret('correct horse battery staple');
    expect(stored).toMatch(/^pbkdf2\$210000\$/);
    expect(stored).not.toContain('correct horse');
    await expect(verifySecret('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifySecret('wrong secret', stored)).resolves.toBe(false);
  });

  it('mints URL-safe, high-entropy session and gallery identifiers', () => {
    const tokens = new Set(Array.from({ length: 128 }, sessionToken));
    expect(tokens.size).toBe(128);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gallerySlug()).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it('generates exactly six decimal PIN digits', () => {
    for (let index = 0; index < 100; index++) expect(generatePin()).toMatch(/^\d{6}$/);
  });

  it('generates lexically sortable ULIDs and hashes tokens deterministically', async () => {
    expect(ulid(1_000) < ulid(2_000)).toBe(true);
    await expect(sha256Hex('token')).resolves.toMatch(/^[0-9a-f]{64}$/);
    await expect(sha256Hex('token')).resolves.toBe(await sha256Hex('token'));
  });
});
