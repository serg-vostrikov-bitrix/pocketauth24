import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

// Without a build (tests, `npm run dev`), `/` stays the JSON 404.
export async function registerWeb(app: FastifyInstance, webRoot: string): Promise<void> {
  if (!existsSync(join(webRoot, 'index.html'))) return;
  await app.register(fastifyStatic, {
    root: webRoot,
    // One route per file found at boot, so unknown paths still reach the JSON 404 handler.
    wildcard: false,
    index: false,
    decorateReply: true,
    cacheControl: false,
    setHeaders: (reply, path) => {
      if (path.endsWith(`${sep}index.html`)) {
        reply.header('cache-control', 'no-cache');
        reply.header('content-security-policy', CSP);
        reply.header('x-content-type-options', 'nosniff');
      } else if (path.includes(`${sep}assets${sep}`)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.get('/', async (_request, reply) => reply.sendFile('index.html'));
}
