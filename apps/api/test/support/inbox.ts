import type TestAgent from 'supertest/lib/agent';
import { ORIGIN } from './fixtures';

export async function createEmailInbox(as: TestAgent, name = 'Sales email', address = 'sales@acme.test') {
  const res = await as.post('/api/v1/inboxes').set('Origin', ORIGIN).send({ name, channel: 'EMAIL', address }).expect(201);
  return res.body as { inbox: { id: string }; webhookSecret: string };
}

export const startConversation = (as: TestAgent, body: object) => as.post('/api/v1/conversations').set('Origin', ORIGIN).send(body);

export const sendMessage = (as: TestAgent, conversationId: string, body: object) =>
  as.post(`/api/v1/conversations/${conversationId}/messages`).set('Origin', ORIGIN).send(body);
