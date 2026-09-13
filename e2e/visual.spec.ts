import { expect, test } from '@playwright/test';
import { mockTeam, mockGallery } from './fixtures';

test('anonymous team routes require login', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/events');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('member sees assigned photos without lead controls', async ({ page }) => {
  await mockTeam(page, 'member');
  await page.goto('/events/image-test/photos');
  await expect(page.getByRole('heading', { name: 'Photographs' })).toBeVisible();
  await expect(page.locator('.select-dot')).toHaveCount(0);
  await expect(page.locator('nav').getByText('Galleries', { exact: true })).toHaveCount(0);
  await page.goto('/events/image-test/galleries');
  await expect(page.getByRole('alert')).toHaveText('Only the event lead can manage galleries.');
});

test('customer needs the PIN even on the view URL and can lock again', async ({ page }) => {
  await mockGallery(page);
  await page.goto('/gallery/test-gallery-123456/view');
  await expect(page.getByText('Private collection')).toBeVisible();
  await page.getByRole('textbox').fill('000000');
  await page.getByRole('button', { name: 'Enter gallery' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect PIN');
  await page.getByRole('textbox').fill('482917');
  await page.getByRole('button', { name: 'Enter gallery' }).click();
  await expect(page.getByRole('region', { name: 'Photo gallery' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock gallery', exact: true }).click();
  await expect(page.getByText('Private collection')).toBeVisible();
});

test('layouts fit desktop and mobile widths', async ({ page }) => {
  await mockTeam(page);
  await mockGallery(page);
  for (const width of [375, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/events/image-test/photos', '/gallery/test-gallery-123456']) {
      await page.goto(path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        )
        .toBe(true);
    }
  }
});
