import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Env } from '@leadora/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ENV } from './infra/tokens';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable('x-powered-by');

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
