import request from 'supertest';
import type { TestApp } from './app';

export const ORIGIN = 'http://localhost:8080';

export const ADMIN = {
  organizationName: 'Acme Sales BD',
  fullName: 'Rahim Uddin',
  email: 'rahim@acme.test',
  password: 'correct horse battery',
};

/** Registers the first organization and returns a cookie-carrying agent for its admin. */
export async function registerAdmin(t: TestApp, overrides: Partial<typeof ADMIN> = {}) {
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ ...ADMIN, ...overrides })
    .expect(201);
  return { agent, user: res.body.user, organization: res.body.organization };
}

export async function login(t: TestApp, email: string, password: string) {
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email, password });
  return { agent, res };
}
