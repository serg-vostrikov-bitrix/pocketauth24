import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from './app.js';
import { loadConfig, PORT } from './config.js';
import { createDb } from './db.js';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);
// ponytail: safe for one instance; add an advisory lock or a separate migrate command for several
await migrate(db, { migrationsFolder: 'drizzle' });
const app = await buildApp({ config, db });
await app.listen({ host: '0.0.0.0', port: PORT });
