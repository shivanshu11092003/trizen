import { expect, test } from '@playwright/test';
import { event, mockTeam, pageInfo, photos } from './fixtures';

test('single and bulk deletion confirm first, preserve failures, and refresh the grid', async ({ page }) => {
  await mockTeam(page);
  let rows = [...photos];
  let singleCalls = 0;
  const batches: string[][] = [];
  await page.route(`**/api/v1/events/${event.id}/photos?*`, (route) =>
    route.fulfill({ json: { data: rows, pageInfo } }),
  );
  await page.route('**/api/v1/photos/photo-0', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    singleCalls++;
    if (singleCalls === 1)
      return route.fulfill({ status: 503, json: { error: { message: 'Deletion unavailable. Try again.' } } });
    rows = rows.filter((photo) => photo.id !== 'photo-0');
    await route.fulfill({ status: 204 });
  });
  await page.route(`**/api/v1/events/${event.id}/photos/delete`, async (route) => {
    const ids = route.request().postDataJSON().photoIds as string[];
    batches.push(ids);
    rows = rows.filter((photo) => !ids.includes(photo.id));
    await route.fulfill({ json: { deleted: ids.length } });
  });
  await page.goto(`/events/${event.id}/photos`);
  await page.getByRole('button', { name: 'Open APW_0.jpg', exact: true }).click();
  await page.getByRole('button', { name: 'Delete photograph', exact: true }).click();
  const single = page.getByRole('dialog', { name: 'Delete photograph?', exact: true });
  await single.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(singleCalls).toBe(0);
  await page.getByRole('button', { name: 'Delete photograph', exact: true }).click();
  await single.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Deletion unavailable. Try again.', { exact: true })).toBeVisible();
  await expect(single).toBeVisible();
  expect(rows).toHaveLength(12);
  await single.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open APW_0.jpg', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark all loaded', exact: true }).click();
  await expect(page.locator('.bulk-bar')).toContainText('11 photographs marked');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  for (const name of ['APW_1.jpg', 'APW_2.jpg'])
    await page.getByRole('button', { name: `Select ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete marked', exact: true }).click();
  const bulk = page.getByRole('dialog', { name: 'Delete 2 photographs?', exact: true });
  await bulk.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(batches).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete marked', exact: true }).click();
  await bulk.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.bulk-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open APW_1.jpg', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open APW_2.jpg', exact: true })).toHaveCount(0);
  expect(batches).toEqual([['photo-1', 'photo-2']]);
});

test('members can mark recent own uploads for deletion without curation actions', async ({ page }) => {
  await mockTeam(page, 'member');
  await page.route(`**/api/v1/events/${event.id}/photos?*`, (route) =>
    route.fulfill({
      json: {
        data: [{ ...photos[0], createdAt: Date.now() }, photos[1]],
        pageInfo,
      },
    }),
  );
  await page.goto(`/events/${event.id}/photos`);
  await expect(page.getByRole('button', { name: 'Mark APW_0.jpg', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark APW_1.jpg', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark APW_0.jpg', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete marked', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to selection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open APW_1.jpg', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete photograph', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Members can delete their own uploads within 15 minutes.', { exact: false }),
  ).toBeVisible();
});
