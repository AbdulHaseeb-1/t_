import { defineConfig } from '@playwright/test';

/**
 * Drives the production web build against a live server (real database + LLM).
 *   pnpm build:web && npx serve dist  (or any static server)  -> E2E_APP_URL
 *   server running with CORS_ORIGINS including that origin
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 45_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_APP_URL ?? 'http://localhost:8090',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
  },
});
