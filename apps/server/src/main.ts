import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  const config = app.get(AppConfig);

  await app.register(helmet);
  await app.register(compress, { threshold: 1024 });
  const origins = config.get('CORS_ORIGINS');
  if (origins.length) app.enableCors({ origin: origins });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT'), config.get('HOST'));
}
await bootstrap();
