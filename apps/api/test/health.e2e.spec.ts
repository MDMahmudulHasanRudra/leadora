import 'reflect-metadata';
import { Controller, Get, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { HealthModule } from '../src/health/health.module';
import { DB, VALKEY } from '../src/infra/tokens';
import { Global, Module } from '@nestjs/common';

@Controller('boom')
class BoomController {
  @Get('not-found')
  notFound() {
    throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
  }

  @Get('crash')
  crash() {
    throw new Error('secret internal detail');
  }
}

function buildInfra(dbOk: boolean, valkeyOk: boolean) {
  @Global()
  @Module({
    providers: [
      {
        provide: DB,
        useValue: {
          pool: { query: () => (dbOk ? Promise.resolve({}) : Promise.reject(new Error('db down'))) },
        },
      },
      {
        provide: VALKEY,
        useValue: { ping: () => (valkeyOk ? Promise.resolve('PONG') : Promise.reject(new Error('valkey down'))) },
      },
    ],
    exports: [DB, VALKEY],
  })
  class FakeInfra {}
  return FakeInfra;
}

async function createApp(dbOk = true, valkeyOk = true): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [buildInfra(dbOk, valkeyOk), HealthModule],
    controllers: [BoomController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

describe('health endpoints', () => {
  let app: INestApplication;
  afterEach(async () => app?.close());

  it('GET /health/live is always ok', async () => {
    app = await createApp(false, false);
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready is 200 when dependencies are up', async () => {
    app = await createApp(true, true);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.postgres.status).toBe('up');
    expect(res.body.checks.valkey.status).toBe('up');
  });

  it('GET /health/ready is 503 when a dependency is down', async () => {
    app = await createApp(true, false);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks.valkey).toMatchObject({ status: 'down', error: 'valkey down' });
  });
});

describe('error contract', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => app.close());

  it('uses the domain error code from the exception', async () => {
    const res = await request(app.getHttpServer()).get('/boom/not-found').expect(404);
    expect(res.body.error).toMatchObject({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
    expect(res.body.error).toHaveProperty('requestId');
  });

  it('hides internal error details', async () => {
    const res = await request(app.getHttpServer()).get('/boom/crash').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
