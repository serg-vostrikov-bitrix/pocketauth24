import { expect, it } from 'vitest';
import { startApp } from '../helpers.js';

it('GET /health returns ok', async () => {
  const t = await startApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await t.close();
});
