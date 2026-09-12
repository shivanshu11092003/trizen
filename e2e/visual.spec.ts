import { expect, test } from '@playwright/test';

test('admin visual demo remains usable without the Worker', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(page.getByText('Arjun & Priya Wedding')).toBeVisible();
  await page.getByText('Arjun & Priya Wedding').click();
  await expect(page.getByRole('heading', { name: 'Arjun & Priya Wedding' })).toBeVisible();
});

test('client can unlock and browse the local gallery demo', async ({ page }) => {
  await page.goto('/gallery/arjun-priya-demo');
  await expect(page.getByText('Private collection')).toBeVisible();
  await page.getByRole('textbox').fill('274913');
  await expect(page.getByRole('heading', { name: 'Arjun & Priya' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wedding gallery' })).toBeVisible();
});

test('layouts have no horizontal overflow at the required review widths', async ({ page }) => {
  for (const width of [375, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 800 ? 812 : 1000 });
    for (const path of ['/events/demo/photos', '/gallery/arjun-priya-demo/view']) {
      if (path.includes('/view')) await page.evaluate(() => sessionStorage.setItem('gallery:arjun-priya-demo', 'open'));
      await page.goto(path);
      if (path.includes('/view')) {
        await expect(page.getByRole('heading', { name: 'Arjun & Priya' })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: 'Photographs' })).toBeVisible();
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`${path.includes('/view') ? 'gallery' : 'admin'}-${width}.png`),
        fullPage: false,
      });
    }
  }
});
