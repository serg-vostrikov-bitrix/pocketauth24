import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startApp, type TestApp } from '../helpers.js';

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

let webRoot: string;
let emptyRoot: string;
let t: TestApp;
beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'b24auth-web-'));
  emptyRoot = await mkdtemp(join(tmpdir(), 'b24auth-web-empty-'));
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><div id="root"></div>');
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1);');
  t = await startApp({ webRoot });
});
afterAll(async () => {
  await t.close();
  await rm(webRoot, { recursive: true, force: true });
  await rm(emptyRoot, { recursive: true, force: true });
});

it('GET / returns the status page with security headers', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^text\/html/);
  expect(res.body).toContain('<div id="root">');
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

it('GET /assets/* returns the file with an immutable cache header', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

it('Unknown path returns the JSON 404', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/unknown' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
});

// Guards the no-build branch; it also passes before registerWeb exists.
it('Without index.html in webRoot, / returns the JSON 404', async () => {
  const bare = await startApp({ webRoot: emptyRoot });
  try {
    const res = await bare.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
  } finally {
    await bare.close();
  }
});
