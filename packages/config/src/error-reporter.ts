import { randomUUID } from 'node:crypto';

/**
 * Error tracking (spec §70, §141) without an SDK: unexpected errors are posted as Sentry envelopes, which Sentry
 * and self-hosted GlitchTip both accept. Off unless ERROR_TRACKING_DSN is set.
 *
 * Privacy: an event carries the error, its stack, the service, ids (request, organization, user) and the request
 * method and path. Never query strings, bodies, headers, cookies, emails or phone numbers.
 */
export interface ErrorReporterOptions {
  dsn: string;
  service: string;
  environment: string;
  release?: string;
  /** Events sent per minute at most; the rest are dropped (an error storm must not become a request storm). */
  maxPerMinute?: number;
  timeoutMs?: number;
}

/** The event shape sent inside an envelope (the subset of Sentry's event schema we use). */
export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: 'error';
  environment: string;
  release?: string;
  tags: Record<string, string>;
  user?: { id: string };
  request?: { method: string; url: string };
  exception: { values: { type: string; value: string; stacktrace: { frames: Frame[] } }[] };
}

export interface ErrorContext {
  tags?: Record<string, string | undefined>;
  user?: { id?: string };
  request?: { method: string; url: string };
}

export function parseDsn(dsn: string): { endpoint: string; publicKey: string } {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error('Invalid error tracking DSN');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !projectId) throw new Error('Invalid error tracking DSN: expected https://<key>@<host>/<project>');
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`, publicKey: url.username };
}

interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

function frames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!;
    out.push({ function: m[1] ?? '?', filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') });
  }
  // Sentry expects the innermost frame last.
  return out.reverse();
}

export class ErrorReporter {
  private readonly endpoint: string;
  private readonly auth: string;
  private windowStart = 0;
  private sentInWindow = 0;

  constructor(private readonly opts: ErrorReporterOptions) {
    const { endpoint, publicKey } = parseDsn(opts.dsn);
    this.endpoint = endpoint;
    this.auth = `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=leadora/1.0`;
  }

  /** Sends the error; resolves once sent, dropped or failed. Never throws. */
  async capture(error: unknown, ctx: ErrorContext = {}): Promise<void> {
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= (this.opts.maxPerMinute ?? 30)) return;
    this.sentInWindow++;

    try {
      const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown');
      const eventId = randomUUID().replace(/-/g, '');
      const tags: Record<string, string> = { service: this.opts.service };
      for (const [k, v] of Object.entries(ctx.tags ?? {})) if (v) tags[k] = v;
      const event: SentryEvent = {
        event_id: eventId,
        timestamp: now / 1000,
        platform: 'node',
        level: 'error',
        environment: this.opts.environment,
        ...(this.opts.release ? { release: this.opts.release } : {}),
        tags,
        ...(ctx.user?.id ? { user: { id: ctx.user.id } } : {}),
        ...(ctx.request ? { request: { method: ctx.request.method, url: ctx.request.url.split('?')[0]! } } : {}),
        exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: frames(err.stack) } }] },
      };
      const body = [JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': this.auth },
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 3000),
      });
    } catch {
      // Reporting must never break the caller; the error is already in the logs.
    }
  }
}

let current: ErrorReporter | null = null;
const pending = new Set<Promise<void>>();

/** Configures the process-wide reporter (null or an empty DSN turns it off). */
export function configureErrorReporting(opts: ErrorReporterOptions | null): void {
  current = opts?.dsn ? new ErrorReporter(opts) : null;
}

/** Fire-and-forget report of an unexpected error. */
export function reportError(error: unknown, ctx?: ErrorContext): void {
  if (!current) return;
  const p = current.capture(error, ctx).finally(() => pending.delete(p));
  pending.add(p);
}

/** Waits for reports in flight (tests, graceful shutdown). */
export async function flushErrorReports(): Promise<void> {
  await Promise.all([...pending]);
}
