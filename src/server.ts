import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from './app.js';
import { CLEANUP_INTERVAL_MS, loadConfig, PORT } from './config.js';
import { createDb } from './db.js';
import { deleteExpiredPairs } from './tokens.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
// ponytail: safe for one instance; add an advisory lock or a separate migrate command for several
await migrate(db, { migrationsFolder: 'drizzle' });
// dist/server.js → /app/public in the image; the Dockerfile copies web/dist there.
const webRoot = fileURLToPath(new URL('../public', import.meta.url));
const app = await buildApp({ config, db, webRoot });

const cleanup = setInterval(() => {
  deleteExpiredPairs(db, new Date()).catch((err: unknown) => {
    app.log.error({ err }, 'token_cleanup_failed');
  });
}, CLEANUP_INTERVAL_MS);

const shutdown = async (): Promise<void> => {
  clearInterval(cleanup);
  await app.close();
  await pool.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: '0.0.0.0', port: PORT });
