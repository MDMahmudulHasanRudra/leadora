import type { IncomingMessage } from 'node:http';
import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { Env } from '@leadora/config';
import { REALTIME_CHANNEL, type RealtimeEvent } from '@leadora/domain';
import { parseCookie } from 'cookie';
import type Redis from 'ioredis';
import type WebSocket from 'ws';
import { IdentityService } from '../auth/identity.service';
import { SESSION_COOKIE, SessionsService } from '../auth/sessions.service';
import { ENV, VALKEY } from '../infra/tokens';

interface Client {
  userId: string;
  organizationId: string;
  sessionToken: string;
}

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN_ORIGIN = 4403;
// Sessions can be revoked (logout, user disabled); re-check before delivering after this long.
const REVALIDATE_MS = 60_000;

/**
 * Spec §24. Identity comes from the session cookie only; rooms are derived server-side.
 * Events arrive on Valkey pub/sub so every API instance can reach its own sockets.
 */
@WebSocketGateway({ path: '/api/v1/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly clients = new Map<WebSocket, Client & { checkedAt: number }>();
  private subscriber?: Redis;
  private readonly allowedOrigins: Set<string>;

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) env: Env,
    private readonly sessions: SessionsService,
    private readonly identity: IdentityService,
  ) {
    this.allowedOrigins = new Set(env.APP_ORIGINS);
  }

  async onModuleInit() {
    this.subscriber = this.valkey.duplicate({ enableOfflineQueue: true });
    this.subscriber.on('message', (_channel, raw) => void this.dispatch(raw));
    await this.subscriber.subscribe(REALTIME_CHANNEL);
  }

  async onModuleDestroy() {
    for (const ws of this.clients.keys()) ws.close(1001);
    await this.subscriber?.quit().catch(() => undefined);
  }

  private async authenticate(req: IncomingMessage): Promise<Client | null> {
    const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
    if (!token) return null;
    const session = await this.sessions.findActive(token);
    if (!session) return null;
    const identity = await this.identity.load(session.userId, session.organizationId);
    if (!identity || identity.user.status !== 'ACTIVE') return null;
    return { userId: identity.user.id, organizationId: identity.organization.id, sessionToken: token };
  }

  async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.has(origin)) return ws.close(CLOSE_FORBIDDEN_ORIGIN, 'Origin not allowed');
    const client = await this.authenticate(req).catch(() => null);
    if (!client) return ws.close(CLOSE_UNAUTHENTICATED, 'Sign in required');
    this.clients.set(ws, { ...client, checkedAt: Date.now() });
    // Clients wait for this before relying on delivery: 'open' fires before authentication finishes.
    ws.send(JSON.stringify({ type: 'ready', data: {} }));
  }

  handleDisconnect(ws: WebSocket) {
    this.clients.delete(ws);
  }

  private async dispatch(raw: string) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }
    const payload = JSON.stringify({ type: event.type, data: event.data });
    for (const [ws, client] of this.clients) {
      if (client.organizationId !== event.organizationId) continue;
      if (event.userId && client.userId !== event.userId) continue;
      if (Date.now() - client.checkedAt > REVALIDATE_MS || event.type === 'ping') {
        const session = await this.sessions.findActive(client.sessionToken).catch(() => null);
        if (!session) {
          this.clients.delete(ws);
          ws.close(CLOSE_UNAUTHENTICATED, 'Session ended');
          continue;
        }
        client.checkedAt = Date.now();
      }
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}
