import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Served by the API server at /bench (same origin, no CORS). In development,
 * `pnpm dev` proxies /bench/api to the server (BENCH_API, default :3000).
 */
export default defineConfig({
  base: '/bench/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/bench/api': process.env.BENCH_API ?? 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 600 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
