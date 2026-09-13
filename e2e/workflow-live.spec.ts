import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
test.use({ baseURL: process.env.LIVE_APP_URL || process.env.PUBLIC_ORIGIN || 'http://localhost:5173' });

test('live lead, member and customer workflow', async ({ browser, baseURL }) => {
  test.skip(process.env.LIVE_SUPABASE_TESTS !== '1', 'Run pnpm test:e2e:live with Supabase configured.');
  test.setTimeout(180_000);
  const postgres = requireApi('postgres');
  const { createClient } = requireApi('@supabase/supabase-js');
  const db = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(process.env.SUPABASE_STORAGE_BUCKET);
  const suffix = crypto.randomUUID();
  const leadEmail = `browser-lead-${suffix}@example.test`,
    memberEmail = `browser-member-${suffix}@example.test`;
  const password = `Browser!${crypto.randomUUID()}`;
  const leadContext = await browser.newContext(),
    memberContext = await browser.newContext(),
    customerContext = await browser.newContext();
  for (const context of [leadContext, memberContext, customerContext]) context.setDefaultTimeout(15000);
  let eventId: string | undefined;
  try {
    const lead = await leadContext.newPage();
    await lead.goto(`${baseURL}/register`);
    await lead.getByLabel('Display name').fill('Browser Test Lead');
    await lead.getByLabel('Email address').fill(leadEmail);
    await lead.getByLabel('Password', { exact: true }).fill(password);
    await lead.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await lead.getByRole('button', { name: 'New event', exact: true }).click();
    await lead.getByLabel('Event name').fill('Browser workflow event');
    await lead.getByRole('button', { name: 'Create event', exact: true }).click();
    await expect(lead.getByRole('heading', { name: 'Browser workflow event' })).toBeVisible();
    eventId = new URL(lead.url()).pathname.split('/')[2];
    await lead.locator('nav').getByText('Team', { exact: true }).click();
    await lead.getByRole('button', { name: 'Add member', exact: true }).click();
    await lead.getByLabel('Name', { exact: true }).fill('Browser Member');
    await lead.getByLabel('Email', { exact: true }).fill(memberEmail);
    await lead.getByRole('button', { name: 'Add to event', exact: true }).click();
    const access = lead.getByRole('dialog', { name: 'Member sign-in details' });
    await expect(access).toBeVisible();
    const temporaryPassword = await access
      .locator('label')
      .filter({ hasText: 'Temporary password' })
      .locator('strong')
      .innerText();
    await access.getByRole('button', { name: 'Close', exact: true }).click();

    const member = await memberContext.newPage();
    await member.goto(`${baseURL}/login`);
    await member.getByLabel('Email address').fill(memberEmail);
    await member.getByLabel('Password', { exact: true }).fill(temporaryPassword);
    await member.getByRole('button', { name: 'Sign in', exact: true }).click();
    await member.getByRole('heading', { name: 'Browser workflow event' }).click();
    await member.getByRole('link', { name: 'Upload photos', exact: true }).click();
    const png = readFileSync(new URL('../apps/web/public/assets/wedding-contact-sheet.png', import.meta.url));
    await member.getByLabel('Choose photographs').setInputFiles([
      { name: 'first.png', mimeType: 'image/png', buffer: png },
      { name: 'second.png', mimeType: 'image/png', buffer: png },
      { name: 'third.png', mimeType: 'image/png', buffer: png },
    ]);
    let failedOnce = false;
    await member.route('**/storage/v1/object/upload/sign/**', (route) => {
      if (!failedOnce && route.request().method() === 'PUT') {
        failedOnce = true;
        return route.abort('failed');
      }
      return route.continue();
    });
    await member.getByRole('button', { name: 'Start upload', exact: true }).click();
    await expect(member.getByText('2 of 3 ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await member.getByRole('button', { name: 'Retry unfinished uploads', exact: true }).click();
    await expect(member.getByText('3 of 3 ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await member.getByRole('link', { name: 'View photographs', exact: true }).click();
    await expect(member.locator('.photo-tile')).toHaveCount(3);
    await expect(member.locator('.select-dot')).toHaveCount(0);

    await lead.goto(`${baseURL}/events/${eventId}/photos`);
    await expect(lead.locator('.photo-tile')).toHaveCount(3);
    await lead.getByRole('button', { name: 'Select first.png', exact: true }).click();
    await lead.getByRole('button', { name: 'Add to selection', exact: true }).click();
    await expect(lead.getByText('Selection updated', { exact: true })).toBeVisible();
    await lead.locator('nav').getByText('Galleries', { exact: true }).click();
    await lead.getByRole('button', { name: 'New gallery', exact: true }).click();
    await lead.getByLabel('Gallery title').fill('Customer workflow collection');
    await lead.getByLabel('Six-digit PIN', { exact: true }).fill('482917');
    await lead.getByRole('button', { name: 'Create gallery', exact: true }).click();
    const credentials = lead.getByRole('dialog', { name: 'Gallery access details' });
    await expect(credentials).toBeVisible();
    const url = await credentials.getByRole('link', { name: 'Open customer gallery' }).getAttribute('href');
    expect(url).toBeTruthy();
    await credentials.getByRole('button', { name: 'Close', exact: true }).click();

    const customer = await customerContext.newPage();
    await customer.goto(url! + '/view');
    await expect(customer.getByText('Private collection')).toBeVisible();
    await customer.getByRole('textbox').fill('000000');
    await customer.getByRole('button', { name: 'Enter gallery' }).click();
    await expect(customer.getByRole('alert')).toBeVisible();
    await customer.getByRole('textbox').fill('482917');
    await customer.getByRole('button', { name: 'Enter gallery' }).click();
    await expect(customer.locator('.masonry-item')).toHaveCount(1);
    await expect(customer.locator('.photo-image.is-ready img')).toBeVisible({ timeout: 30_000 });
    await customer.getByRole('button', { name: 'Lock gallery', exact: true }).click();
    await expect(customer.getByText('Private collection')).toBeVisible();
    // Delete one original through its preview, then a real multi-photo batch.
    await lead.goto(`${baseURL}/events/${eventId}/photos`);
    await lead.getByRole('button', { name: 'Open third.png', exact: true }).click();
    await lead.getByRole('button', { name: 'Delete photograph', exact: true }).click();
    await lead
      .getByRole('dialog', { name: 'Delete photograph?', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(lead.locator('.photo-tile')).toHaveCount(2);
    await lead.getByRole('button', { name: 'Mark all loaded', exact: true }).click();
    await lead.getByRole('button', { name: 'Delete marked', exact: true }).click();
    await lead
      .getByRole('dialog', { name: 'Delete 2 photographs?', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(lead.locator('.photo-tile')).toHaveCount(0);
    await customer.reload();
    await expect(customer.getByText('A story in 0 photographs')).toBeVisible();
    await customer.getByRole('textbox').fill('482917');
    await customer.getByRole('button', { name: 'Enter gallery' }).click();
    await expect(customer.getByText('No photographs are currently available.', { exact: false })).toBeVisible();
    await expect(customer.locator('.masonry-item')).toHaveCount(0);
    await lead.goto(`${baseURL}/events/${eventId}/galleries`);
    await lead.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await expect(lead.getByText('unpublished', { exact: true })).toBeVisible();
    await customer.reload();
    await expect(customer.getByRole('heading', { name: 'Gallery unavailable' })).toBeVisible();
  } finally {
    await Promise.allSettled([leadContext.close(), memberContext.close(), customerContext.close()]);
    try {
      const users = await db`select id from users where email in ${db([leadEmail, memberEmail])}`;
      const ids = users.map((user: { id: string }) => user.id);
      const owned = ids.length ? await db`select id from events where owner_id in ${db(ids)}` : [];
      for (const event of owned) {
        const images = await db`select storage_key from photos where event_id=${event.id}`;
        if (images.length) {
          const { error } = await storage.remove(
            images.map((image: { storage_key: string }) => image.storage_key),
          );
          if (error) throw error;
        }
        await db`delete from events where id=${event.id}`;
      }
      if (ids.length) {
        await db`delete from audit_log where actor_id in ${db(ids)}`;
        await db`delete from users where id in ${db(ids)}`;
      }
    } finally {
      await db.end({ timeout: 1 });
    }
  }
});
