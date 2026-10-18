import { expect, type Page, test } from '@playwright/test';

/**
 * Select `count` free seats and hold them. Projects run in parallel against the same
 * shows, so another worker may win a seat first; like a real user, re-pick and retry.
 */
async function holdSeats(page: Page, count: number) {
  const map = page.getByRole('group', { name: 'Seat map' });
  // "How many seats?" — pick the count; tapping a seat then grabs that many together.
  const picker = page.getByRole('dialog', { name: 'How many seats?' });
  await picker.getByRole('radio', { name: String(count), exact: true }).click();
  await picker.getByRole('button', { name: /^Select \d+ seats?$/ }).click();
  await expect(picker).toBeHidden();
  for (let attempt = 0; attempt < 5; attempt++) {
    const selected = map.locator('button[aria-pressed="true"]');
    while ((await selected.count()) < count) {
      const free = map.locator('button[aria-label*=", available"]');
      const n = await free.count();
      await free.nth(Math.floor(Math.random() * n)).click();
    }
    await expect(selected).toHaveCount(count);
    await page.getByRole('button', { name: /^Pay/ }).click();
    const won = await page
      .getByRole('heading', { name: 'Booking summary' })
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (won) return;
  }
  throw new Error('Could not hold seats after 5 attempts');
}

/** A fresh browser is asked for its city once. */
async function pickCity(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: /^Bengaluru/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/**
 * Definition of done: a stranger can sign up, book 2 seats and see a QR ticket
 * in under 2 minutes.
 */
test('sign up → pick a show → 2 seats → pay → QR ticket', async ({ page }) => {
  const started = Date.now();
  const email = `e2e.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Password', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Now Showing' })).toBeVisible();

  await pickCity(page);

  await page.getByRole('heading', { name: 'Now Showing' }).scrollIntoViewIfNeeded();
  await page.locator('section[aria-labelledby="now-showing"] a').first().click();
  await page.getByRole('link', { name: 'Book tickets' }).click();

  await page.locator('a[href^="/showtimes/"]').first().click();
  await expect(page.getByRole('group', { name: 'Seat map' })).toBeVisible();

  await holdSeats(page, 2);
  await expect(page.getByRole('heading', { name: 'Booking summary' })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('Seats held for');
  await page.getByRole('link', { name: /Proceed to pay/ }).click();

  await expect(page.getByText('TEST MODE')).toBeVisible();
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Name on card').fill('E2E Tester');
  await page.getByLabel('Expiry (MM/YY)').fill('1239');
  await page.getByLabel('CVV').fill('123');
  await page.getByRole('button', { name: 'Pay securely' }).click();

  await expect(page.getByText('Booking confirmed!')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: /QR code for booking CB/ })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(120_000);
});

test('declined card releases the seats and explains why', async ({ page }) => {
  const email = `e2e.fail.${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Password', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await pickCity(page);

  await page.locator('section[aria-labelledby="now-showing"] a').nth(1).click();
  await page.getByRole('link', { name: 'Book tickets' }).click();
  await page.locator('a[href^="/showtimes/"]').last().click();
  await holdSeats(page, 1);
  await page.getByRole('link', { name: /Proceed to pay/ }).click();

  await page.getByLabel('Card number').fill('4000020000000000');
  await page.getByLabel('Name on card').fill('E2E Tester');
  await page.getByLabel('Expiry (MM/YY)').fill('1239');
  await page.getByLabel('CVV').fill('123');
  await page.getByRole('button', { name: 'Pay securely' }).click();
  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Back to seat selection' }).click();
  await expect(page.getByText('Payment failed. Please choose your seats again.')).toBeVisible();
});
