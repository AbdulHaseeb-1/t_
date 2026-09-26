import { expect, type Page, test } from '@playwright/test';

/**
 * Real end to end: production web bundle -> live API -> SQL Server -> LLM.
 * Expected numbers are ground truth from the Eval_Retail fixture database.
 */

/** Every run exercises real model round trips: clear the server's answer cache first. */
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
test.beforeAll(async ({ request }) => {
  await request.delete(`${API}/query/cache`);
});

const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/shots';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
}

/** The progress row (stage + timer) and the streaming cursor are both gone. */
async function lastAnswerDone(page: Page) {
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByLabel('Response in progress')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    // English is the default display language; Urdu has its own suite.
    localStorage.setItem('settings.language', JSON.stringify('en'));
  });
  await page.goto('/');
  await expect(page.getByText('What would you like to know?')).toBeVisible();
});

test('answers from the real database and shows its evidence', async ({ page }) => {
  const errors = watchErrors(page);
  await ask(page, 'How many customers are based in Pakistan?');
  await expect(page.getByRole('progressbar')).toBeVisible();
  await lastAnswerDone(page);
  await expect(page.getByText(/115/).first()).toBeVisible();

  // Queries are hidden by default: the panel offers the data only.
  await expect(page.getByRole('button', { name: 'Show query and data' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show data' }).click();
  await expect(page.getByText(/'PK'/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/answer-light.png` });

  // Turning "Show SQL queries" on reveals the query behind the same answer.
  await openSettings(page);
  await page.getByRole('switch', { name: 'Show SQL queries' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  // The panel stays open and now carries the query as well.
  await expect(page.getByRole('button', { name: 'Hide query and data' })).toBeVisible();
  await expect(page.getByText(/'PK'/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows token usage, cache and timing details for an answer', async ({ page }) => {
  await ask(page, 'What was net revenue by sales channel in 2025?');
  await lastAnswerDone(page);
  await expect(page.getByTestId(/^chart-(bars|donut)$/)).toBeVisible();
  await page.getByTestId('usage-pill').click();
  await expect(page.getByText('This conversation')).toBeVisible();
  await expect(page.getByText('Input', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await page.getByLabel(/^Details: /).click();
  await expect(page.getByText('Answer details')).toBeVisible();
  await expect(page.getByText('Model', { exact: true })).toBeVisible();
  await expect(page.getByText('Database', { exact: true })).toBeVisible();
  await expect(page.getByText(/Whole schema|tables/).first()).toBeVisible();
});

test('resolves follow-up questions from the conversation', async ({ page }) => {
  await ask(page, 'How many customers are based in Pakistan?');
  await lastAnswerDone(page);
  await expect(page.getByText(/115/).first()).toBeVisible();

  // Enter sends on the web.
  await page.getByRole('textbox', { name: 'Message' }).fill('And in the UAE?');
  await page.keyboard.press('Enter');
  await lastAnswerDone(page);
  await expect(page.getByText(/\b57\b/).first()).toBeVisible();
});

test('keeps conversations across reloads and switches between them', async ({ page }) => {
  await ask(page, 'How many orders are still pending?');
  await lastAnswerDone(page);
  await expect(page.getByText(/\b91\b/).first()).toBeVisible();

  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await ask(page, 'How many sales reps were hired before 2021?');
  await lastAnswerDone(page);
  await expect(page.getByText(/\b9\b/).first()).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await expect(page.getByRole('button', { name: 'Open How many orders are still pending?' })).toBeVisible();
  await page.getByRole('button', { name: 'Open How many orders are still pending?' }).click();
  await expect(page.getByText(/\b91\b/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How many orders are still pending?' })).toBeVisible();
});

test('stops a request and retries it', async ({ page }) => {
  await ask(page, 'What was net revenue by customer country code in 2025?');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await lastAnswerDone(page);
  await expect(page.getByRole('button', { name: 'Show data' })).toBeVisible();
});

test('explains an unreachable server and recovers after fixing settings', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('row-server').click();
  const address = page.getByRole('textbox', { name: 'Server address' });
  const good = await address.inputValue();
  await address.fill('localhost:9');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Can't reach the server at http:\/\/localhost:9/)).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Server, localhost:9' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await ask(page, 'How many customers do we have?');
  await expect(page.getByText(/Can't reach the server/)).toBeVisible();

  // The error offers a direct way to fix the address.
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('textbox', { name: 'Server address' }).fill(good);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/^Connected\. Database is up/)).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Retry' }).click();
  await lastAnswerDone(page);
  await expect(page.getByText(/\b400\b/).first()).toBeVisible();
});

test('replies in Roman Urdu when chosen, and the choice persists', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Reply language, Auto' }).click();
  await page.getByRole('radio', { name: 'Roman Urdu' }).click();
  await expect(page.getByRole('radio', { name: 'Roman Urdu' })).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.screenshot({ path: `${SHOTS}/settings.png` });
  await page.getByRole('button', { name: 'Close settings' }).click();

  await ask(page, 'How many customers do we have?');
  await lastAnswerDone(page);
  // Roman Urdu: Latin script, Urdu grammar ("Ap k 400 customers hain").
  await expect(page.getByText(/\bhain\b/i).first()).toBeVisible();
  await expect(page.getByText(/\b400\b/).first()).toBeVisible();

  await page.reload();
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Reply language, Roman Urdu' })).toBeVisible();
});

test('renders tables in dark mode', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('settings.language', JSON.stringify('en')));
  await page.goto('/');
  await ask(page, 'For each sales channel, what percentage of its orders were cancelled (0-100)? Show a table.');
  await lastAnswerDone(page);
  await expect(page.getByText(/Store/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/answer-dark.png` });
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/drawer-dark.png` });
  await ctx.close();
});

test('performance: fast start, fonts loaded, long chats render quickly, typing stays smooth', async ({ page }) => {
  // Cold start to interactive.
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  // Includes Nastaliq now: Urdu is the default interface language.
  const startMs = Date.now() - t0;
  const fonts = await page.evaluate(() =>
    ['SourceSerif4_400Regular', 'DMSans_400Regular', 'NotoNastaliqUrdu_400Regular'].map((f) => document.fonts.check(`16px ${f}`)),
  );
  expect(fonts).toEqual([true, true, true]);

  // A 240-message conversation, seeded directly into storage.
  await page.evaluate(() => {
    const messages = [];
    for (let i = 0; i < 120; i++) {
      messages.push({ id: `u${i}`, role: 'user', text: `Question number ${i}?` });
      messages.push({
        id: `a${i}`,
        role: 'assistant',
        question: `Question number ${i}?`,
        status: 'done',
        text: `Answer **${i}**.\n\n| Region | Revenue |\n|---|---:|\n| North | ${i * 10} |\n| South | ${i * 7} |`,
        sql: `SELECT ${i}`,
        result: { columns: [{ name: 'n', type: 'int' }], rows: [[i]], rowCount: 1, truncated: false, elapsedMs: 1 },
        meta: { totalMs: 1000, cached: false },
      });
    }
    const chat = { id: 'long', title: 'Long conversation', createdAt: 1, updatedAt: Date.now(), messages };
    localStorage.setItem('chats.v1', JSON.stringify([chat]));
  });
  await page.reload();
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.getByRole('button', { name: 'Open Long conversation' }).click();
  await expect(page.getByText('Question number 119?')).toBeVisible();
  const longChatMs = Date.now() - t1;
  // Virtualized: only a window of the 240 rows is mounted.
  const mountedRows = await page.getByText(/^Question number \d+\?$/).count();

  // Typing: count main-thread long tasks while entering 60 characters.
  await page.evaluate(() => {
    (window as unknown as { __long: number }).__long = 0;
    new PerformanceObserver((l) => {
      (window as unknown as { __long: number }).__long += l.getEntries().filter((e) => e.duration > 50).length;
    }).observe({ type: 'longtask', buffered: false });
  });
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  const t2 = Date.now();
  await page.keyboard.type('Which products had the highest margin last quarter, by region?', { delay: 15 });
  const typingMs = Date.now() - t2;
  const longTasks = await page.evaluate(() => (window as unknown as { __long: number }).__long);

  console.log(JSON.stringify({ startMs, longChatMs, mountedRows, typingMs, longTasks }));
  expect(startMs).toBeLessThan(4000);
  expect(longChatMs).toBeLessThan(2000);
  expect(mountedRows).toBeLessThan(120);
  expect(longTasks).toBeLessThanOrEqual(1);
});
