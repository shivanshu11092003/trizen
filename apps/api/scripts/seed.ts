import { eventMembers, events, galleries, galleryPhotos, photos, users } from '../src/db/schema.js';
import { hashSecret } from '../src/lib/crypto.js';
import { closeDatabase, databaseFor } from '../src/services/database.js';
import type { Env } from '../src/types.js';
import { fixedId } from './seed-ids.js';
import { seedImages } from './seed-images.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required. Set it in the root .env file.');

const db = databaseFor({ DATABASE_URL: databaseUrl } as Env);
const now = Date.now();
const password = 'TrizenDemo!2026';
const pin = '274913';

const adminId = fixedId(1);
const member1Id = fixedId(2);
const member2Id = fixedId(3);
const outsiderId = fixedId(4);
const eventId = fixedId(10);
const outsiderEventId = fixedId(11);
const galleryId = fixedId(20);
const pepper = process.env.PIN_PEPPER;
if (!pepper) throw new Error('PIN_PEPPER is required in the root .env file.');
const passwordHash = await hashSecret(password, pepper);
const pinHash = await hashSecret(pin, pepper);
const slug = 'arjun-priya-2026-demo';

try {
  const people = [
    { id: adminId, email: 'admin@demo.trizen.dev', passwordHash, displayName: 'Priya Sharma', isPlatformAdmin: true, createdAt: now, updatedAt: now },
    { id: member1Id, email: 'member1@demo.trizen.dev', passwordHash, displayName: 'Meera Joshi', isPlatformAdmin: false, createdAt: now, updatedAt: now },
    { id: member2Id, email: 'member2@demo.trizen.dev', passwordHash, displayName: 'Nikhil Rao', isPlatformAdmin: false, createdAt: now, updatedAt: now },
    { id: outsiderId, email: 'outsider@demo.trizen.dev', passwordHash, displayName: 'Outside Studio', isPlatformAdmin: true, createdAt: now, updatedAt: now },
  ];
  for (const person of people) {
    await db.insert(users).values(person).onConflictDoUpdate({
      target: users.id,
      set: { email: person.email, passwordHash, displayName: person.displayName, isPlatformAdmin: person.isPlatformAdmin, updatedAt: now },
    });
  }

  await db.insert(events).values([
    { id: eventId, name: 'Arjun & Priya Wedding', description: 'Three days of ceremony, family, and a monsoon clearing before portraits.', eventDate: now + 12 * 86_400_000, ownerId: adminId, status: 'active', createdAt: now - 4 * 86_400_000, updatedAt: now },
    { id: outsiderEventId, name: 'Private competitor event', description: 'The demo admin is intentionally not a member.', eventDate: null, ownerId: outsiderId, status: 'active', createdAt: now - 3 * 86_400_000, updatedAt: now },
  ]).onConflictDoNothing();

  await db.insert(eventMembers).values([
    { eventId, userId: adminId, role: 'admin', addedBy: adminId, addedAt: now - 3 * 86_400_000 },
    { eventId, userId: member1Id, role: 'member', addedBy: adminId, addedAt: now - 3 * 86_400_000 },
    { eventId, userId: member2Id, role: 'member', addedBy: adminId, addedAt: now - 3 * 86_400_000 },
    { eventId: outsiderEventId, userId: outsiderId, role: 'admin', addedBy: outsiderId, addedAt: now - 3 * 86_400_000 },
  ]).onConflictDoNothing();

  const photoRows = Array.from({ length: 1250 }, (_, index) => {
    const createdAt = now - index * 45_000;
    const id = fixedId(1000 + index);
    const filename = `APW_${String(index + 1).padStart(4, '0')}.jpg`;
    return {
      id,
      eventId,
      uploadedBy: index % 2 ? member1Id : member2Id,
      filename,
      filenameLower: filename.toLowerCase(),
      storageKey: `events/${eventId}/photos/${id}.jpg`,
      contentType: 'image/jpeg',
      fileSize: 4_000_000 + (index % 19) * 110_000,
      width: 3200,
      height: 2133,
      dominantColor: '#38231e',
      takenAt: index % 11 === 0 ? null : createdAt - 3_600_000,
      status: 'ready' as const,
      isSelected: index < 600,
      createdAt,
      updatedAt: createdAt,
    };
  });
  for (let index = 0; index < photoRows.length; index += 250) {
    await db.insert(photos).values(photoRows.slice(index, index + 250)).onConflictDoNothing();
  }
  await seedImages(db);

  await db.insert(galleries).values({
    id: galleryId,
    eventId,
    slug,
    title: 'Arjun & Priya — Highlights',
    pinHash,
    pinSetAt: now,
    status: 'published',
    publishedAt: now,
    expiresAt: now + 30 * 86_400_000,
    allowDownload: true,
    viewCount: 38,
    lastViewedAt: now - 420_000,
    createdBy: adminId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({ target: galleries.id, set: { pinHash, pinSetAt: now, expiresAt: now + 30 * 86_400_000, updatedAt: now } });

  for (let index = 0; index < 600; index += 200) {
    await db.insert(galleryPhotos).values(
      photoRows.slice(index, index + 200).map((photo, offset) => ({
        galleryId,
        photoId: photo.id,
        sortOrder: index + offset,
        addedAt: now,
      })),
    ).onConflictDoNothing();
  }

  console.log(`\nSeeded 1,250 photo records in Supabase Postgres.\nAdmin: admin@demo.trizen.dev / ${password}\nMember: member1@demo.trizen.dev / ${password}\nGallery: http://localhost:5173/gallery/${slug}\nPIN: ${pin}`);
} finally {
  await closeDatabase(db);
}
