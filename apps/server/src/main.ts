import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true }),
    // rawBody: the WhatsApp webhook signature is computed over the exact bytes Meta sent.
    { bufferLogs: true, rawBody: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(AppConfig);
  await app.listen(config.get('PORT'), config.get('HOST'));
}
await bootstrap();
