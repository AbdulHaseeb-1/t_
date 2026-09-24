import { defineConfig } from '@playwright/test';

/**
 * Drives the built bench UI served by a live API server (real database + LLM):
 *   pnpm --filter web build && BENCH_ENABLED=true pnpm --filter server start:prod
 *   BENCH_URL=http://localhost:3000/bench/ pnpm --filter web test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BENCH_URL ?? 'http://localhost:3000/bench/',
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
  },
});
