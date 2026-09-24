import { expect, type Page, test } from '@playwright/test';

/**
 * Real end to end: bench UI -> server -> eval harness -> real models and database.
 * Kept cheap: the "hard" cases only, two models, one repeat.
 * BENCH_MODELS picks the models (comma-separated search terms; default: the
 * server's current model plus gpt-4.1-mini).
 */
const MODELS = (process.env.BENCH_MODELS ?? 'current,gpt-4.1-mini').split(',');
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/shots';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

async function pickModels(page: Page) {
  for (const m of MODELS) {
    if (m === 'current') {
      await page.getByRole('button', { name: /^Current model/ }).click();
      continue;
    }
    const search = page.getByRole('combobox', { name: 'Search models' });
    await search.fill(m);
    await page.getByRole('option').filter({ hasText: m }).first().click();
  }
  await expect(page.getByLabel('Selected models').locator('.picked-row')).toHaveCount(MODELS.length);
}

test('benchmarks two models end to end and drills into a case', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'New benchmark' })).toBeVisible();
  await expect(page.getByLabel('Dataset', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^hard \d+/ }).click();
  await expect(page.getByText(/of \d+ cases selected/)).toBeVisible();
  await pickModels(page);
  await expect(page.getByText(/≈ \$|unknown/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bench-setup.png`, fullPage: true });

  await page.getByRole('button', { name: 'Start benchmark' }).click();
  await expect(page).toHaveURL(/#\/run\//);
  await expect(page.getByRole('progressbar').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bench-live.png` });

  // Finished: leaderboard, charts, breakdowns and the case matrix.
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 540_000 });
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await expect(page.locator('table.data').first().locator('tbody tr')).toHaveCount(MODELS.length);
  await expect(page.getByRole('img', { name: /Accuracy versus cost/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Median and 95th percentile/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bench-results.png`, fullPage: true });

  await page.getByRole('button', { name: /^All \(\d+\)/ }).click();
  await page.locator('tr.clickable').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Gold', { exact: true })).toBeVisible();
  await expect(drawer.locator('pre.sql').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bench-case.png` });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // The run is listed in History and reopens from there.
  await page.getByRole('link', { name: 'History' }).click();
  const first = page.locator('tr.clickable').first();
  await expect(first).toContainText('mds-epd');
  await expect(first.getByText('web')).toBeVisible();
  await first.click();
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('playground: one question, two models, agreement shown', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/playground');
  await page.getByLabel('Question').fill('How many customers are there?');
  await pickModels(page);
  await page.getByRole('button', { name: /^Ask/ }).click();
  await expect(page.getByText(/models returned the same data|returned different data|Not enough/)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('pre.sql').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bench-playground.png`, fullPage: true });
  expect(errors).toEqual([]);
});
