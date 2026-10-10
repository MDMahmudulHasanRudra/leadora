import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { baseLoggerOptions } from '@leadora/config';
import type { Params } from 'nestjs-pino';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

export function loggerParams(level: string): Params {
  return {
    pinoHttp: {
      ...baseLoggerOptions('api', level),
      genReqId: resolveRequestId,
      // Spec §70: every request log names the tenant and user (set by the auth guard before the response is logged).
      customProps: (req) => {
        const r = req as IncomingMessage & { id?: unknown; auth?: { organizationId: string; userId: string; apiKeyId?: string } };
        return { requestId: r.id, organizationId: r.auth?.organizationId, userId: r.auth?.userId, apiKeyId: r.auth?.apiKeyId };
      },
      // Headers are deliberately not logged: they can carry tokens and PII.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') || (req.url ?? '').startsWith('/metrics') },
    },
  };
}
