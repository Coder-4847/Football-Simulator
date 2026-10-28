import { expect, test, type Page } from '@playwright/test';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

test('loads the landing page without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('.logo').first()).toBeVisible();
  await expect(page.getByText('Exhibition match')).toBeVisible();
  expect(errors).toEqual([]);
});

test('runs an exhibition match to full time', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByText('Exhibition match').click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Paused').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.keyboard.press('KeyF');
  await expect(page.getByRole('button', { name: 'Start second half' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Start second half' }).click();
  await expect(page.locator('.modal').getByText('Exhibition')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('settings are searchable', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Settings', { exact: true }).first().click();
  await page.getByPlaceholder('Search settings…').fill('shadows');
  await expect(page.getByText('Shadows').first()).toBeVisible();
});

test('career starts and reaches a matchday', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByText('Start your career').click();
  await page.getByRole('button', { name: 'Start career' }).click();
  const cta = page.locator('.topbar .btn.primary');
  await expect(cta).toBeVisible();
  for (let i = 0; i < 6 && !/Matchday/.test(await cta.innerText()); i++) { await cta.click(); await page.waitForTimeout(1200); }
  await cta.click();
  await expect(page.getByRole('button', { name: 'Kick off' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate' })).toBeVisible();
  expect(errors).toEqual([]);
});
