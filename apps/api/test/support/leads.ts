import type TestAgent from 'supertest/lib/agent';
import { ORIGIN } from './fixtures';

export const LEAD = {
  fullName: 'Sadia Islam',
  email: 'Sadia@Example.com',
  phone: '01712-345678',
  companyName: 'Rupali Traders',
};

export const createLead = (as: TestAgent, body: object = LEAD) => as.post('/api/v1/leads').set('Origin', ORIGIN).send(body);

export const patchLead = (as: TestAgent, id: string, body: object) =>
  as.patch(`/api/v1/leads/${id}`).set('Origin', ORIGIN).send(body);

export async function stageId(as: TestAgent, key: string): Promise<string> {
  const { body } = await as.get('/api/v1/pipelines').expect(200);
  return body.items[0].stages.find((s: { key: string }) => s.key === key).id;
}
