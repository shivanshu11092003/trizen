import { expect, test } from '@playwright/test';
import { event, mockTeam, mockGallery, pageInfo, photos } from './fixtures';

test('workspace shows useful controls and theme survives reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockTeam(page);
  await page.goto('/events');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.getByText('Search the workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'API reference' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: test.info().outputPath('events-desktop.png') });
  await page.locator('.event-row').click();
  await expect(page).toHaveURL(`/events/${event.id}`);
  await page.screenshot({ path: test.info().outputPath('workspace.png') });
});

test('mixed photo proportions stay aligned when the grid resizes', async ({ page }) => {
  await mockTeam(page);
  await page.route(`**/api/v1/events/${event.id}/photos**`, (route) =>
    route.fulfill({
      json: {
        data: photos.map((photo, index) => ({
          ...photo,
          width: index % 2 ? 1200 : 400,
          height: index % 2 ? 400 : 1200,
        })),
        pageInfo,
      },
    }),
  );
  await page.goto(`/events/${event.id}/photos`);
  for (const width of [1440, 768, 375, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const row = page.locator('.photo-grid-row').first();
    await expect(row.locator('.photo-image').first()).toBeVisible();
    await expect
      .poll(() =>
        row.evaluate((element) => {
          const images = [...element.querySelectorAll('.photo-image')].map((image) =>
            image.getBoundingClientRect(),
          );
          return images.every(
            (rect) =>
              Math.abs(rect.width / rect.height - 1.5) < 0.02 &&
              Math.abs(rect.height - images[0]!.height) < 1,
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect.poll(() => row.locator('.photo-tile').count()).toBe(width < 1000 ? 2 : 4);
  }
  await page.screenshot({ path: test.info().outputPath('photos-desktop.png') });
  await expect(page.locator('.photo-caption').first()).toContainText('1000 B');
  await page.getByRole('button', { name: 'Open APW_0.jpg', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.ant-drawer .photo-image')).toHaveCSS('aspect-ratio', '400 / 1200');
});

test('photo search, filters, and sort reach the API', async ({ page }) => {
  await mockTeam(page);
  await page.goto(`/events/${event.id}/photos`);
  const searched = page.waitForRequest(
    (r) => r.url().includes('/photos?') && new URL(r.url()).searchParams.get('search') === 'portrait',
  );
  await page.getByRole('textbox', { name: 'Search filenames' }).fill('portrait');
  await searched;
  const selected = page.waitForRequest(
    (r) => r.url().includes('/photos?') && new URL(r.url()).searchParams.get('selected') === 'true',
  );
  await page.getByText('Selected', { exact: true }).click();
  await selected;
  const sorted = page.waitForRequest(
    (r) => r.url().includes('/photos?') && new URL(r.url()).searchParams.get('sort') === 'filename',
  );
  await page.getByRole('combobox', { name: 'Sort photographs' }).selectOption('filename');
  await sorted;
});

test('team sorting and explicit removal work', async ({ page }) => {
  await mockTeam(page);
  let members = [
    {
      userId: 'lead',
      displayName: 'Test Photographer',
      email: 'lead@example.test',
      role: 'admin',
      photoCount: 9,
      addedAt: 1,
    },
    {
      userId: 'member',
      displayName: 'Meera',
      email: 'meera@example.test',
      role: 'member',
      photoCount: 2,
      addedAt: 1,
    },
  ];
  await page.route(`**/api/v1/events/${event.id}/members?*`, (route) =>
    route.fulfill({ json: { data: members, pageInfo } }),
  );
  await page.route(`**/api/v1/events/${event.id}/members/member`, async (route) => {
    expect(route.request().method()).toBe('DELETE');
    members = members.filter((member) => member.userId !== 'member');
    await route.fulfill({ status: 204 });
  });
  await page.goto(`/events/${event.id}/team`);
  await expect(page.getByRole('button', { name: 'Remove Test Photographer' })).toHaveCount(0);
  await page.getByRole('columnheader', { name: 'Uploads' }).click();
  await expect(page.locator('tr.ant-table-row').first()).toContainText('Meera');
  await page.getByRole('button', { name: 'Remove Meera', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Meera' })).toHaveCount(0);
});

test('mobile menu closes after navigation and event cards fit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockTeam(page);
  await page.goto(`/events/${event.id}/photos`);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Dismiss navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'All events', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dismiss navigation' })).toHaveCount(0);
  await expect(page.locator('.event-role')).toBeVisible();
  await expect(page.locator('.event-date')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('events-mobile.png') });
});

test('customer preview closes with Escape and restores focus', async ({ page }) => {
  await mockGallery(page);
  await page.goto('/gallery/test-gallery-123456');
  await page.getByRole('textbox').fill('482917');
  await page.getByRole('button', { name: 'Enter gallery' }).click();
  const photo = page.getByRole('button', { name: 'Open APW_0.jpg', exact: true });
  await photo.click();
  await expect(page.getByRole('button', { name: 'Close photograph' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(photo).toBeFocused();
});
