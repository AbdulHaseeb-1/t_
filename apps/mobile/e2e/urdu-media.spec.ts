import { expect, type Page, test } from '@playwright/test';

/**
 * Urdu-first flows against the live stack: typed Urdu, a real spoken Urdu
 * voice message (Chromium's fake microphone plays a WAV), a real photo of an
 * Urdu question, and charts. Ground truth: Eval_Retail has 115 customers in Pakistan.
 */

/** Every run exercises real model round trips: clear the server's answer cache first. */
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
test.beforeAll(async ({ request }) => {
  await request.delete(`${API}/query/cache`);
});

const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/shots';
const VOICE_WAV = process.env.E2E_VOICE_WAV ?? '/tmp/media/voice-ur.wav';
const QUESTION_PNG = process.env.E2E_QUESTION_PNG ?? '/tmp/media/question.png';

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${VOICE_WAV}`],
  },
  permissions: ['microphone'],
});

async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByText('آپ کیا جاننا چاہتے ہیں؟')).toBeVisible();
}

async function done(page: Page) {
  await expect(page.getByLabel('جواب تیار ہو رہا ہے')).toHaveCount(0, { timeout: 60_000 });
}

/** Computed style of the element holding the given text (the paragraph, not a span). */
async function textStyle(page: Page, text: RegExp) {
  return page.getByText(text).first().evaluate((el) => {
    const s = getComputedStyle(el.closest('[dir], div') ?? el);
    const own = getComputedStyle(el);
    return { font: own.fontFamily, direction: s.direction || own.direction, align: own.textAlign };
  });
}

test('Urdu is the default: Urdu question, Urdu answer in Nastaliq', async ({ page }) => {
  await fresh(page);
  await expect(page.getByPlaceholder('اپنے ڈیٹا کے بارے میں پوچھیں')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('پاکستان میں ہمارے کتنے گاہک ہیں؟');
  await page.getByRole('button', { name: 'بھیجیں' }).click();
  await done(page);
  const answer = page.getByText(/115/).first();
  await expect(answer).toBeVisible();
  // The answer is Urdu prose (not just a number) and rendered right-to-left in Nastaliq.
  const text = await answer.evaluate((el) => (el.closest('div')?.textContent ?? el.textContent) || '');
  expect(text).toMatch(/[\u0600-\u06FF]{3,}/);
  const style = await textStyle(page, /115/);
  expect(style.font).toContain('NotoNastaliqUrdu');
  await page.screenshot({ path: `${SHOTS}/urdu-answer.png` });
});

test('voice message: spoken Urdu is heard, answered and shown', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'آواز کا پیغام ریکارڈ کریں' }).click();
  await expect(page.getByLabel('ریکارڈنگ', { exact: true })).toBeVisible();
  await page.waitForTimeout(4200);
  await page.getByRole('button', { name: 'آواز کا پیغام بھیجیں' }).click();
  await expect(page.getByLabel(/^آواز کا پیغام \d:\d\d$/)).toBeVisible();
  await done(page);
  // What was heard replaces the placeholder in the bubble and titles the chat.
  await expect(page.getByText(/پاکستان/).first()).toBeVisible();
  await expect(page.getByText(/115/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/urdu-voice.png` });
});

test('photo: an Urdu question in an image is read and answered', async ({ page }) => {
  await fresh(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'تصویر شامل کریں' }).click();
  await (await chooser).setFiles(QUESTION_PNG);
  await expect(page.getByRole('button', { name: 'تصویر ہٹائیں' })).toBeVisible();
  await page.getByRole('button', { name: 'بھیجیں' }).click();
  await done(page);
  await expect(page.getByText(/115/).first()).toBeVisible();
  await expect(page.getByText(/^تصویر سے:/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/urdu-photo.png` });
});

test('charts: grouped results draw as bars, time series as lines', async ({ page }) => {
  await fresh(page);
  await page.getByRole('textbox', { name: 'Message' }).fill('ہر سیلز چینل کی کل خالص آمدنی کتنی ہے؟');
  await page.getByRole('button', { name: 'بھیجیں' }).click();
  await done(page);
  await expect(page.getByLabel('Bar chart')).toBeVisible();

  await page.getByRole('textbox', { name: 'Message' }).fill('2025 کی ماہانہ خالص آمدنی مہینے کے نمبر کے ساتھ دکھائیں');
  await page.getByRole('button', { name: 'بھیجیں' }).click();
  await done(page);
  await expect(page.getByLabel('Line chart')).toBeVisible();
  await page.getByLabel('Line chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/urdu-charts.png` });
});

test('switching to English applies instantly and persists', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'گفتگوئیں کھولیں' }).click();
  await page.getByRole('button', { name: 'سیٹنگز' }).click();
  // The first "English" is the interface language (the reply-language group has one too).
  await page.getByRole('radio', { name: 'English' }).first().click();
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.reload();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
});
