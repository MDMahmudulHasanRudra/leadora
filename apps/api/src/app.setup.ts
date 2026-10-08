import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from './common/http-exception.filter';

export function configureApp(app: NestExpressApplication): void {
  app.use(cookieParser());
  // Inbound emails can exceed the 100 kB default.
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
    ],
  });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  // Caddy is the only hop in front of the API; trust exactly one proxy for client IPs.
  express.set('trust proxy', 1);
}
