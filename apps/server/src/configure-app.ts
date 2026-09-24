import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppConfig } from './config/app-config.js';

/** Plugins shared by the server and the end-to-end tests, so tests run the real configuration. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get(AppConfig);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // The bench UI is served over plain HTTP on a LAN address; upgrading its assets to HTTPS would break it.
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(multipart, {
    limits: {
      files: 2,
      fields: 8,
      fieldSize: 64 * 1024,
      fileSize: Math.max(config.get('MEDIA_MAX_AUDIO_MB'), config.get('MEDIA_MAX_IMAGE_MB')) * 1024 * 1024,
    },
  });
  // Web benchmark UI (apps/web build) at /bench, only when the bench is enabled and built.
  const ui = resolve(config.get('BENCH_UI_DIR'));
  if (config.get('BENCH_ENABLED') && existsSync(resolve(ui, 'index.html'))) {
    app.useStaticAssets({ root: ui, prefix: '/bench/', index: 'index.html', decorateReply: false });
    app.getHttpAdapter().get('/bench', (_req, reply) => reply.redirect('/bench/', 302));
  }
  const origins = config.get('CORS_ORIGINS');
  if (origins.length) app.enableCors({ origin: origins });
}
