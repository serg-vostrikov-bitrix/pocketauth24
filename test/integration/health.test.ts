import { expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

it('GET /health returns ok', async () => {
  const app = await buildApp({
    config: { baseUrl: 'https://auth.test', databaseUrl: 'postgres://unused', portalAllowlist: [] },
  });
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await app.close();
});
