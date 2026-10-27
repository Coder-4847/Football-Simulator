import { expect, test, type Page } from '@playwright/test';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

test('loads the main menu without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByText('Football Simulator').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quick match' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('starts a quick match, plays and pauses', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick match' }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space'); // skip line-up
  await page.waitForTimeout(3000);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  const state = await page.evaluate(() => { const a = (window as unknown as { __app: { session: { match: { time: number; phase: string } } } }).__app; return { t: a.session.match.time, phase: a.session.match.phase }; });
  expect(state.t).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('settings are searchable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('Search settings…').fill('shadows');
  await expect(page.getByText('Shadows').first()).toBeVisible();
});

test('career starts and advances', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Career' }).click();
  await page.getByRole('button', { name: 'Start career' }).click();
  await expect(page.getByText('Season 2026 · Week 1')).toBeVisible();
  await page.getByRole('button', { name: 'Skip to next match' }).click();
  await expect(page.getByText(/Week \d+/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
