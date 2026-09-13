import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const event = {
  id: 'image-test',
  name: 'Arjun & Priya Wedding',
  description: 'Wedding photographs',
  eventDate: null,
  role: 'admin',
  status: 'active',
  ownerId: 'lead',
  createdAt: 1,
  updatedAt: 1,
};
export const pageInfo = {
  nextCursor: null,
  prevCursor: null,
  hasNextPage: false,
  hasPrevPage: false,
  limit: 48,
};
export const photos = Array.from({ length: 12 }, (_, index) => ({
  id: `photo-${index}`,
  eventId: event.id,
  uploadedBy: 'member',
  filename: `APW_${index}.jpg`,
  storageKey: `events/image-test/photo-${index}.jpg`,
  contentType: 'image/jpeg',
  fileSize: 1000,
  width: 600,
  height: 400,
  dominantColor: '#20252c',
  caption: null,
  takenAt: null,
  status: 'ready',
  isSelected: false,
  createdAt: index,
}));
export const fixtureImage = fileURLToPath(
  new URL('../apps/web/public/assets/wedding-contact-sheet.png', import.meta.url),
);

export async function mockTeam(page: Page, role: 'admin' | 'member' = 'admin') {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 404, json: { error: { message: 'Not found' } } }),
  );
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: role === 'admin' ? 'lead' : 'member',
          displayName: 'Test Photographer',
          email: 'test@example.test',
          isPlatformAdmin: role === 'admin',
          createdAt: 1,
        },
        memberships: [{ eventId: event.id, eventName: event.name, role }],
        csrfToken: 'test',
        sessionId: 'test',
      },
    }),
  );
  await page.route('**/api/v1/events?*', (route) =>
    route.fulfill({ json: { data: [{ ...event, role }], pageInfo } }),
  );
  await page.route(`**/api/v1/events/${event.id}`, (route) => route.fulfill({ json: { ...event, role } }));
  await page.route(`**/api/v1/events/${event.id}/photos**`, (route) =>
    route.fulfill({ json: { data: photos, pageInfo } }),
  );
  await page.route('**/img/**', (route) => route.fulfill({ contentType: 'image/png', path: fixtureImage }));
}

export async function mockGallery(page: Page) {
  let unlocked = false;
  const base = '**/api/v1/public/galleries/test-gallery-123456';
  await page.route(`${base}`, (route) =>
    route.fulfill({
      json: {
        title: 'Arjun & Priya',
        photoCount: photos.length,
        allowDownload: false,
        expiresAt: null,
        unlocked,
      },
    }),
  );
  await page.route(`${base}/unlock`, async (route) => {
    unlocked = route.request().postDataJSON().pin === '482917';
    await route.fulfill(
      unlocked ? { status: 204 } : { status: 401, json: { error: { message: 'Incorrect PIN' } } },
    );
  });
  await page.route(`${base}/photos?*`, (route) =>
    route.fulfill(unlocked ? { json: { data: photos, pageInfo } } : { status: 401, json: {} }),
  );
  await page.route(`${base}/photos/*/image/*`, (route) =>
    route.fulfill(unlocked ? { contentType: 'image/png', path: fixtureImage } : { status: 401, json: {} }),
  );
  await page.route(`${base}/lock`, async (route) => {
    unlocked = false;
    await route.fulfill({ status: 204 });
  });
}
