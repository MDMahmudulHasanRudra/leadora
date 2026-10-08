import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Env } from '@leadora/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV } from './infra/tokens';

async function bootstrap() {
  // rawBody: webhook signatures are computed over the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Leadora API').setVersion('v1').build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
