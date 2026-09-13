import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mockTeam } from './fixtures';

test('photo errors show a fallback and do not prevent another detail image loading', async ({ page }) => {
  await mockTeam(page);
  await page.route('**/api/v1/events/image-test/photos**', (route) =>
    route.fulfill({
      json: {
        data: ['missing', 'available'].map((name, index) => ({
          id: name,
          eventId: 'image-test',
          uploadedBy: 'test-user',
          filename: `${name}.jpg`,
          storageKey: `events/image-test/${name}.jpg`,
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
        })),
        pageInfo: { nextCursor: null, prevCursor: null, hasNextPage: false, hasPrevPage: false, limit: 48 },
      },
    }),
  );
  await page.route('**/img/**', (route) =>
    route.request().url().includes('/missing.jpg')
      ? route.fulfill({ status: 404, json: {} })
      : route.fulfill({
          contentType: 'image/png',
          path: fileURLToPath(
            new URL('../apps/web/public/assets/wedding-contact-sheet.png', import.meta.url),
          ),
        }),
  );

  await page.goto('/events/image-test/photos');
  const missing = page.locator('.photo-tile').filter({ hasText: 'missing.jpg' });
  const available = page.locator('.photo-tile').filter({ hasText: 'available.jpg' });
  await expect(missing.getByRole('img', { name: 'Image unavailable: missing.jpg' })).toBeVisible();
  await expect(missing.locator('img')).toHaveCount(0);
  await expect(available.locator('.photo-image.is-ready img')).toBeVisible();

  await missing.locator('.photo-click').click();
  await expect(page.locator('.ant-drawer').getByText('Image unavailable', { exact: true })).toBeVisible();
  await page.locator('.ant-drawer-close').click();
  await available.locator('.photo-click').click();
  await expect(page.locator('.ant-drawer .photo-image.is-ready img')).toBeVisible();
  await expect(page.locator('.ant-drawer').getByText('Image unavailable', { exact: true })).toHaveCount(0);
});
