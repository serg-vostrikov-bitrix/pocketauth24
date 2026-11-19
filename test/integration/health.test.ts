import { expect, it } from 'vitest';
import { DEAD_DATABASE_URL, startApp } from '../helpers.js';

it('GET /health returns ok', async () => {
  const t = await startApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await t.close();
});

it('GET /health returns 503 when the database is down', async () => {
  const t = await startApp({ databaseUrl: DEAD_DATABASE_URL });
  try {
    const started = Date.now();
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', database: 'down' });
    expect(t.logs.find((l) => l.msg === 'database_probe_failed')).toBeDefined();
    expect(t.logs.find((l) => l.msg === 'request_failed')).toMatchObject({
      status: 503,
      level: 40,
    });
  } finally {
    await t.close();
  }
});
