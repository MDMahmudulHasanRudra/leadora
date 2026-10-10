import type { NextFunction, Request, Response } from 'express';
import { MetricsRegistry } from '@leadora/config';

/** One registry per process (spec §70). Route labels use the matched template, never raw URLs (bounded cardinality). */
export const registry = new MetricsRegistry({ service: 'api' });

const httpRequests = registry.counter('http_requests_total', 'HTTP requests by method, route template and status class');

// Spec §68 targets sit at 0.5s (CRUD) and 0.8s (lists).
const httpDuration = registry.histogram('http_request_duration_seconds', 'HTTP request latency', [0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5, 10]);

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/metrics' || req.path.startsWith('/health')) return next();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route as { path?: string } | undefined)?.path ? `${req.baseUrl}${(req.route as { path: string }).path}` : 'unmatched';
    end({ method: req.method, route });
    httpRequests.inc({ method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` });
  });
  next();
}
