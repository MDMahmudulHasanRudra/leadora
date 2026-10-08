import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { TestApp } from './app';

export function sign(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { 'x-leadora-timestamp': String(timestamp), 'x-leadora-signature': `v1=${signature}` };
}

export function postInbound(t: TestApp, inboxId: string, secret: string, payload: object, opts: { timestamp?: number; badSignature?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const headers = sign(opts.badSignature ? 'whsec_wrong' : secret, body, opts.timestamp);
  return request(t.app.getHttpServer())
    .post(`/api/v1/webhooks/inbound/${inboxId}`)
    .set('content-type', 'application/json')
    .set(headers)
    .send(body);
}
