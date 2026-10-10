import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { httpMetricsMiddleware } from './metrics/http-metrics';

export function configureApp(app: NestExpressApplication): void {
  // Spec §91: embeds on customer websites call /api/v1/public/* cross-origin. Allow it without credentials
  // (no cookies cross); each handler enforces its own origin allow-list.
  app.use('/api/v1/public', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-chat-token');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(httpMetricsMiddleware);
  app.use(cookieParser());
  app.useWebSocketAdapter(new WsAdapter(app));
  // Inbound emails can exceed the 100 kB default.
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  // Caddy is the only hop in front of the API; trust exactly one proxy for client IPs.
  express.set('trust proxy', 1);
}
