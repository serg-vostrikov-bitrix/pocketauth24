---
change: admin-panel
design-doc: docs/superpowers/specs/2026-11-18-admin-panel-design.md
base-ref: 576b9e6dc429496ddee51209b7b5927a2b6df76a
---

# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-user admin panel: a superuser that only the CLI sets, viewers that the superuser manages, cookie sessions with a login rate limit, and read-only searchable tables of portals, applications, token metadata and event counters at `/admin`.

**Architecture:** The server gets `src/cli.ts` and the module folder `src/admin/` (password hashing, data access for users and sessions, rate limit, auth hooks and routes, user routes, filter helper, data routes). `registerAdmin` registers one encapsulated Fastify plugin under `/api/admin` with a JSON-only guard and `Cache-Control: no-store`; a nested scope adds the session check. The React package `web/` gets React Router: `/` stays the status page, `/admin/*` loads a lazy admin bundle.

**Tech Stack:** Node 24, TypeScript strict, Fastify 5, `@fastify/cookie`, Drizzle ORM + PostgreSQL 17, `node:crypto` scrypt, vitest with real PostgreSQL, React 19, React Router 7, Vite 8.

## Global Constraints

- The OpenSpec delta specs in `docs/openspec/changes/admin-panel/specs/` are the canonical requirements. The Design Doc refines them; its section 9 governs two points: the server generates viewer passwords (20 characters, shown once), and the token state uses the access token expiry. Do not add features, options or abstractions that the Design Doc does not name.
- English everywhere: code, comments, commit messages, docs. Docs follow ASD-STE100 (short active sentences; "must", "should", "can"; never "shall" or "may").
- Named exports only (except `web/vite.config.ts`). No `enum`: use string literal unions.
- Conventional commits. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Server tests: vitest against real PostgreSQL (`TEST_DATABASE_URL`, default `postgres://b24auth:b24auth@localhost:5432/b24auth_test`). Start it with `docker compose up -d db` if it does not run. `web/` has no test runner: the admin UI gets `npm run web:typecheck`, `npm run web:build` and a manual browser check.
- `web/` is not linted by root ESLint; root Prettier (`singleQuote`, `printWidth: 100`) checks its format.
- **Password hash:** `scrypt(plain, salt16, 64, { N: 32768, r: 8, p: 1, maxmem: 64 MiB })`. Stored format: `scrypt$32768$8$1$<salt b64>$<hash b64>`. Compare with `timingSafeEqual`. `verifyPassword` returns `false` for a malformed value and never throws. `DUMMY_HASH` is computed once at module load.
- **Generated password:** 20 characters from `[A-Za-z0-9]` via `crypto.randomInt`. `MIN_PASSWORD_LENGTH = 12` (CLI only).
- **Login names:** `^[A-Za-z0-9._-]{3,64}$`. The CLI default login is `admin`.
- **CLI:** `node dist/cli.js superuser set-password [--login <name>] [--password-stdin]`; `util.parseArgs` with `strict: true`. Exit codes: `0` saved; `1` any validation failure (short password, mismatch, invalid login, login of a viewer, unknown flag such as `--password`), nothing changed; `2` no TTY and no `--password-stdin`; `130` Ctrl+C at the prompt. Output on success: `Superuser "<login>" saved.` Never print the password. The CLI reads only `DATABASE_URL` and runs migrations first.
- **Cookie:** name `b24a_session`; `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, `Secure` (always, as the `admin-auth` spec requires; browsers accept Secure cookies on `http://localhost`). Value: 32 random bytes, base64url (43 characters). The database stores only its SHA-256 hex in `admin_sessions.id_hash`. Fixed 12-hour lifetime, no idle timeout.
- **Rate limit:** `createLoginLimiter({ max: 5, windowMs: 15 * 60_000 })`, keyed by `request.ip`, in memory, one instance per app.
- **`TRUST_PROXY`:** `true`/`false`, default `false` → Fastify `trustProxy`.
- **Pagination:** page size `50`, `page` is 1-based, order newest first.
- **JSON guard:** `POST`, `PUT`, `PATCH`, `DELETE` under `/api/admin` need a `content-type` that starts with `application/json`, else HTTP 415 `{"error":"unsupported_media_type"}` before any handler. Clients send `{}` as the body of `DELETE` and of `POST` without data.
- **Every `/api/admin` response:** `Cache-Control: no-store`.
- **Endpoints (all under `/api/admin`):**

| Route | Auth | Success | Errors |
|---|---|---|---|
| `POST /login` `{ login, password }` (strings, max 256) | none | 200 `{ login, role }` + cookie | 429 `{"error":"too_many_attempts"}`; 503 `{"error":"no_superuser","hint":"docker compose exec app node dist/cli.js superuser set-password"}`; 401 `{"error":"invalid_credentials"}` |
| `POST /logout` `{}` | session | 204, cookie cleared | 401 |
| `GET /me` | session | 200 `{ login, role }` | 401 `{"error":"unauthorized"}` |
| `GET /users` | superuser | 200 `[{ id, login, role, createdAt }]`, superuser first | 403 `{"error":"forbidden"}` |
| `POST /users` `{ login }` | superuser | 201 `{ id, login, password }` | 400 `{"error":"invalid_login"}`; 409 `{"error":"login_taken"}`; 403 |
| `POST /users/:id/password` `{}` | superuser | 200 `{ password }`; revokes the viewer's sessions | 403 (target is the superuser); 404 `{"error":"not_found"}` |
| `DELETE /users/:id` `{}` | superuser | 204; sessions go by cascade | 403 (target is the superuser); 404 |
| `GET /portals`, `/applications`, `/tokens`, `/events` | session | 200 `{ rows, total, page, pageSize: 50 }` | 400 `{"error":"invalid_filter","column":"<key>"}` |

- **Data columns (key, filter type):**
  - portals: `id` (id), `origin` (text), `clientId` (text), `applications` (none, count subquery), `createdAt` (date); order `createdAt desc, id desc`.
  - applications: `id` (id), `portal` (text, `portals.origin`), `clientId` (text), `title` (text), `redirectUri` (text), `scope` (text), `createdAt` (date); order `createdAt desc, id desc`.
  - tokens: `id` (id), `portal` (text), `application` (text, `applications.title`), `clientId` (text, `applications.client_id`), `userId` (id), `scope` (text), `createdAt`, `accessExpiresAt`, `refreshExpiresAt` (date), `state` (enum `active`/`expired`: `access_expires_at > now()` or not); order `createdAt desc, id desc`.
  - events: `day` (date), `outcome` (enum `delivered`/`failed`/`dropped`), `count` (none); order `day desc, outcome asc`.
- **Filter query format:** `filter[<key>]=<value>`; dates as `filter[<key>.from]` and `filter[<key>.to]` (ISO date or date-time; a date-only `to` includes the whole day). Unknown keys and empty values are ignored. Text: `ILIKE '%v%'` with `\`, `%`, `_` escaped. No query selects `secret_hash`, `access_hash`, `refresh_hash` or `params`.
- **Log events:** `admin_login_succeeded`, `admin_login_failed`, `admin_logout` with `{ login, ip }`; `session_cleanup_failed`. Never log passwords, session IDs or cookie values.
- **UI:** gyroscope on the login page only, size `clamp(100px, 20vw, 160px)`; sidebar becomes a top bar below 720 px; filter debounce 300 ms; rows fade in with the `fade-in` keyframes of `theme.css`; the one-time dialog text is "This password is shown once."; the empty state text is "No matching rows".

## Mapping to tasks.md

| Plan task | tasks.md items |
|---|---|
| Task 1: Password primitives | 1.2 |
| Task 2: Admin tables and migration | 1.1 |
| Task 3: Superuser CLI | 2.1, 2.2 |
| Task 4: Sessions, login, logout and the JSON guard | 3.1, 3.2, 3.3 (JSON guard, login logging) |
| Task 5: Login rate limit, TRUST_PROXY and session cleanup | 3.3 (rate limit, `TRUST_PROXY`), 3.4 |
| Task 6: User management API | 4.1, 4.2, 4.3 |
| Task 7: Filter helper, portals and applications | 5.1, 5.2 (portals, applications), 5.3 |
| Task 8: Tokens and event counters endpoints | 5.2 (tokens, events), 5.3 |
| Task 9: Admin routing, login page and layout | 6.1, 6.2 |
| Task 10: Data table and the four data pages | 6.3, 6.4 (data pages) |
| Task 11: Users page | 6.4 (user management page) |
| Task 12: Documentation | 7.1, 7.2 |

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/config.ts` | Modify | `requiredEnv` export, `MIN_PASSWORD_LENGTH`, `trustProxy` in `Config` |
| `src/schema.ts` | Modify | `AdminRole`, `adminUsers`, `adminSessions` |
| `drizzle/0002_admin_users.sql` | Create (generated) | Migration with the partial unique index |
| `src/admin/password.ts` | Create | `hashPassword`, `verifyPassword`, `DUMMY_HASH`, `generatePassword` |
| `src/admin/sessions.ts` | Create | `createSession`, `findSession`, `deleteSession`, `deleteSessionsOfUser`, `deleteExpiredSessions` |
| `src/admin/users.ts` | Create | Data access for `admin_users` (CLI and routes) |
| `src/cli.ts` | Create | `superuser set-password` |
| `src/admin/rateLimit.ts` | Create | `createLoginLimiter` |
| `src/admin/auth.ts` | Create | Cookie options, JSON guard, session guard, login/logout/me |
| `src/admin/usersRoutes.ts` | Create | User management routes |
| `src/admin/filters.ts` | Create | `Column`, `parseQuery`, `selection`, `escapeLike`, `PAGE_SIZE` |
| `src/admin/dataRoutes.ts` | Create | Four GET endpoints |
| `src/admin/index.ts` | Create | `registerAdmin` |
| `src/app.ts` | Modify | `trustProxy`, `registerAdmin` before `registerWeb` |
| `src/static.ts` | Modify | `GET /admin`, `GET /admin/*` → `index.html` |
| `src/server.ts` | Modify | Hourly `deleteExpiredSessions` |
| `test/helpers.ts` | Modify | `trustProxy` in `TEST_CONFIG`, `truncateAll`, `SUPERUSER`, `createSuperuser`, `loginAs` |
| `test/unit/password.test.ts`, `test/unit/rate-limit.test.ts`, `test/unit/filters.test.ts` | Create | Unit tests |
| `test/integration/admin-cli.test.ts`, `admin-auth.test.ts`, `admin-users.test.ts`, `admin-data.test.ts` | Create | Integration tests |
| `test/integration/static.test.ts` | Modify | `/admin/*` serves `index.html` |
| `web/package.json` | Modify | `react-router` |
| `web/src/main.tsx` | Modify | Router, lazy `AdminApp` |
| `web/src/admin/*` | Create | `api.ts`, `AdminApp.tsx`, `LoginPage.tsx`, `Layout.tsx`, `DataTable.tsx`, `pages.tsx`, `UsersPage.tsx`, `admin.css` |
| `docs/deployment.md`, `README.md`, `.env.example` | Modify | Superuser setup, proxy restriction, `TRUST_PROXY`, features table |

---

### Task 1: Password primitives

- [x] Task 1 complete: Password primitives

**Covers tasks.md:** 1.2

**Files:**
- Create: `src/admin/password.ts`
- Modify: `src/config.ts`
- Test: `test/unit/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, stored: string): Promise<boolean>`, `DUMMY_HASH: string`, `generatePassword(): string` in `src/admin/password.ts`; `MIN_PASSWORD_LENGTH = 12` and `requiredEnv(env: NodeJS.ProcessEnv, name: string): string` in `src/config.ts`.

- [x] **Step 1: Write the failing test** `test/unit/password.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  DUMMY_HASH,
  generatePassword,
  hashPassword,
  verifyPassword,
} from '../../src/admin/password.js';

describe('password hashing', () => {
  it('verifies the password it hashed and rejects another one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
  });

  it('gives different stored values for equal passwords', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('returns false for a malformed stored value', async () => {
    for (const bad of [
      '',
      'plain',
      'scrypt$1$2$3',
      'bcrypt$32768$8$1$c2FsdA==$aGFzaA==',
      'scrypt$x$8$1$c2FsdA==$aGFzaA==',
      'scrypt$3$8$1$c2FsdA==$aGFzaA==',
    ]) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
  });

  it('DUMMY_HASH is a valid hash that matches no ordinary password', async () => {
    expect(DUMMY_HASH).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });

  it('generates 20 characters from [A-Za-z0-9]', () => {
    const values = new Set(Array.from({ length: 50 }, generatePassword));
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(values.size).toBe(50);
  });
});
```

- [x] **Step 2: Run the test to make sure it fails**

Run: `npm test -- test/unit/password.test.ts`
Expected: FAIL, cannot resolve `../../src/admin/password.js`.

- [x] **Step 3: Write the implementation** `src/admin/password.ts`

```ts
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// 128 * N * r = 32 MiB; Node's default maxmem (32 MiB) is too tight for it.
const MAXMEM = 64 * 1024 * 1024;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const GENERATED_LENGTH = 20;

// node:crypto has no promise form of scrypt with options; this is the smallest wrapper.
function scryptAsync(
  plain: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(plain, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (![n, r, p].every(Number.isSafeInteger) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  try {
    const actual = await scryptAsync(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Login verifies against this hash when the login does not exist, so the response time does
// not reveal valid logins.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function generatePassword(): string {
  return Array.from({ length: GENERATED_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    '',
  );
}
```

- [x] **Step 4: Add the config values** in `src/config.ts`

Add after `QS_OPTIONS`:

```ts
// CLI only; generated viewer passwords have 20 characters.
export const MIN_PASSWORD_LENGTH = 12;
```

Rename the private `required` function to an exported `requiredEnv` and update its three call sites in `loadConfig`:

```ts
export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
```

- [x] **Step 5: Run the test to make sure it passes**

Run: `npm test -- test/unit/password.test.ts`
Expected: PASS (5 tests).

- [x] **Step 6: Check types and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add src/admin/password.ts src/config.ts test/unit/password.test.ts
git commit -m "feat(admin): add scrypt password hashing and generation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Admin tables and migration

- [x] Task 2 complete: Admin tables and migration

**Covers tasks.md:** 1.1

**Files:**
- Modify: `src/schema.ts`
- Create (generated): `drizzle/0002_admin_users.sql`, `drizzle/meta/0002_snapshot.json`, `drizzle/meta/_journal.json`
- Modify: `test/helpers.ts`
- Test: `test/integration/admin-users.test.ts` (new file; Task 6 adds more tests)

**Interfaces:**
- Produces: `AdminRole = 'superuser' | 'viewer'`, tables `adminUsers` (`id`, `login`, `passwordHash`, `role`, `createdAt`) and `adminSessions` (`idHash`, `userId`, `expiresAt`) in `src/schema.ts`. `truncateAll` also clears `admin_users` and `admin_sessions`.

- [x] **Step 1: Write the failing test** `test/integration/admin-users.test.ts`

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { adminSessions, adminUsers } from '../../src/schema.js';
import { startApp, truncateAll, type TestApp } from '../helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
});
afterEach(async () => {
  await t.close();
});

it('The database rejects a second superuser and accepts many viewers', async () => {
  await t.db.insert(adminUsers).values({ login: 'root', passwordHash: 'x', role: 'superuser' });
  await expect(
    t.db.insert(adminUsers).values({ login: 'root2', passwordHash: 'x', role: 'superuser' }),
  ).rejects.toThrow();
  await t.db.insert(adminUsers).values([
    { login: 'viewer1', passwordHash: 'x', role: 'viewer' },
    { login: 'viewer2', passwordHash: 'x', role: 'viewer' },
  ]);
  expect(await t.db.$count(adminUsers)).toBe(3);
});

it('Deleting an admin user deletes its sessions', async () => {
  const [user] = await t.db
    .insert(adminUsers)
    .values({ login: 'viewer1', passwordHash: 'x', role: 'viewer' })
    .returning({ id: adminUsers.id });
  await t.db
    .insert(adminSessions)
    .values({ idHash: 'a'.repeat(64), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
  await t.db.delete(adminUsers);
  expect(await t.db.$count(adminSessions)).toBe(0);
});
```

- [x] **Step 2: Run the test to make sure it fails**

Run: `npm test -- test/integration/admin-users.test.ts`
Expected: FAIL, `adminUsers` is not exported from `src/schema.ts`.

- [x] **Step 3: Add the tables** to `src/schema.ts`

Add `uniqueIndex` to the `drizzle-orm/pg-core` import. Append:

```ts
export type AdminRole = 'superuser' | 'viewer';

export const adminUsers = pgTable(
  'admin_users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    login: text('login').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<AdminRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one superuser.
    uniqueIndex('admin_users_one_superuser').on(table.role).where(sql`role = 'superuser'`),
    check('admin_users_role_check', sql`${table.role} in ('superuser', 'viewer')`),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    // SHA-256 hex of the cookie value; the cookie value itself is never stored.
    idHash: text('id_hash').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('admin_sessions_expires_at_idx').on(table.expiresAt)],
);
```

- [x] **Step 4: Generate the migration**

Run: `npm run db:generate -- --name admin_users`
Expected: `drizzle/0002_admin_users.sql` exists. Open it and make sure it contains `CREATE TABLE "admin_users"`, `CREATE TABLE "admin_sessions"`, the foreign key with `ON DELETE cascade`, the check constraint and `CREATE UNIQUE INDEX "admin_users_one_superuser" ON "admin_users" USING btree ("role") WHERE role = 'superuser';`. Do not edit the generated file by hand.

- [x] **Step 5: Update `truncateAll`** in `test/helpers.ts`

```ts
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE portals, applications, token_pairs, event_counters, admin_users, admin_sessions RESTART IDENTITY CASCADE`,
  );
}
```

- [x] **Step 6: Run the test to make sure it passes**

Run: `npm test -- test/integration/admin-users.test.ts`
Expected: PASS (2 tests). The global setup applies the new migration.

- [x] **Step 7: Run the full suite, types and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/schema.ts drizzle test/helpers.ts test/integration/admin-users.test.ts
git commit -m "feat(admin): add admin_users and admin_sessions tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Superuser CLI

- [x] Task 3 complete: Superuser CLI

**Covers tasks.md:** 2.1, 2.2

**Files:**
- Create: `src/admin/sessions.ts` (only `deleteSessionsOfUser` and the `DbOrTx` type in this task)
- Create: `src/admin/users.ts` (only `LOGIN_PATTERN` and `setSuperuser` in this task)
- Create: `src/cli.ts`
- Test: `test/integration/admin-cli.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` (Task 1); `MIN_PASSWORD_LENGTH`, `requiredEnv` (Task 1); `adminUsers`, `adminSessions` (Task 2).
- Produces:
  - `src/admin/sessions.ts`: `type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]`; `deleteSessionsOfUser(db: DbOrTx, userId: number): Promise<void>`.
  - `src/admin/users.ts`: `LOGIN_PATTERN: RegExp` (`/^[A-Za-z0-9._-]{3,64}$/`); `setSuperuser(db: Db, login: string | undefined, passwordHash: string): Promise<{ saved: boolean; login: string }>`.

Decision recorded here: the spec says the CLI replaces the login of an existing superuser only when `--login` is given. So `setSuperuser` takes `login: string | undefined`: without `--login` it keeps the current login, and it uses `admin` only when it creates the first superuser.

- [x] **Step 1: Write the failing test** `test/integration/admin-cli.test.ts`

```ts
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { verifyPassword } from '../../src/admin/password.js';
import { createDb, type Db } from '../../src/db.js';
import { adminSessions, adminUsers } from '../../src/schema.js';
import { TEST_DATABASE_URL, truncateAll } from '../helpers.js';

type CliResult = { code: number | null; stdout: string; stderr: string };

// Spawned without a TTY: the CLI sees process.stdin.isTTY as undefined.
function runCli(args: string[], stdin = ''): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const SET = ['superuser', 'set-password'];
const PASSWORD = 'first-password-123';
const NEW_PASSWORD = 'second-password-456';

let db: Db;
let close: () => Promise<void>;
beforeAll(() => {
  const created = createDb(TEST_DATABASE_URL);
  db = created.db;
  close = () => created.pool.end();
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await truncateAll(db);
});

async function superusers() {
  return db.select().from(adminUsers).where(eq(adminUsers.role, 'superuser'));
}

it('Creates the superuser from stdin and never prints the password', { timeout: 20_000 }, async () => {
  const res = await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`);
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe('Superuser "admin" saved.');
  expect(res.stdout + res.stderr).not.toContain(PASSWORD);
  const [user] = await superusers();
  expect(user.login).toBe('admin');
  expect(user.passwordHash).not.toContain(PASSWORD);
  expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
});

it('A second run replaces the hash and the login and deletes the sessions', { timeout: 30_000 }, async () => {
  await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`);
  const [before] = await superusers();
  await db
    .insert(adminSessions)
    .values({ idHash: 'b'.repeat(64), userId: before.id, expiresAt: new Date(Date.now() + 60_000) });

  const res = await runCli([...SET, '--login', 'root', '--password-stdin'], `${NEW_PASSWORD}\n`);
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe('Superuser "root" saved.');
  const [after] = await superusers();
  expect(after.id).toBe(before.id);
  expect(after.login).toBe('root');
  expect(await verifyPassword(NEW_PASSWORD, after.passwordHash)).toBe(true);
  expect(await db.$count(adminSessions)).toBe(0);
});

it('Without --login a second run keeps the current login', { timeout: 30_000 }, async () => {
  await runCli([...SET, '--login', 'root', '--password-stdin'], `${PASSWORD}\n`);
  const res = await runCli([...SET, '--password-stdin'], `${NEW_PASSWORD}\n`);
  expect(res.stdout.trim()).toBe('Superuser "root" saved.');
  const [user] = await superusers();
  expect(user.login).toBe('root');
});

it('A short password exits with 1 and changes nothing', { timeout: 20_000 }, async () => {
  const res = await runCli([...SET, '--password-stdin'], 'short-pass\n');
  expect(res.code).toBe(1);
  expect(await db.$count(adminUsers)).toBe(0);
});

it('The --password flag is rejected', { timeout: 20_000 }, async () => {
  const res = await runCli([...SET, '--password', PASSWORD]);
  expect(res.code).toBe(1);
  expect(await db.$count(adminUsers)).toBe(0);
});

it('The login of a viewer exits with 1 and changes nothing', { timeout: 20_000 }, async () => {
  await db.insert(adminUsers).values({ login: 'alice', passwordHash: 'x', role: 'viewer' });
  const res = await runCli([...SET, '--login', 'alice', '--password-stdin'], `${PASSWORD}\n`);
  expect(res.code).toBe(1);
  expect(await superusers()).toHaveLength(0);
});

it('Without a TTY and without --password-stdin the command exits with 2', { timeout: 20_000 }, async () => {
  const res = await runCli(SET);
  expect(res.code).toBe(2);
  expect(res.stderr).toContain('--password-stdin');
});
```

- [x] **Step 2: Run the test to make sure it fails**

Run: `npm test -- test/integration/admin-cli.test.ts`
Expected: FAIL, `src/cli.ts` does not exist (non-zero exit codes, wrong output).

- [x] **Step 3: Write `src/admin/sessions.ts`** (first part)

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminSessions } from '../schema.js';

export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export async function deleteSessionsOfUser(db: DbOrTx, userId: number): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
}
```

- [x] **Step 4: Write `src/admin/users.ts`** (first part)

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminUsers } from '../schema.js';
import { deleteSessionsOfUser } from './sessions.js';

export const LOGIN_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const DEFAULT_SUPERUSER_LOGIN = 'admin';

// Without a login, an existing superuser keeps its login; a new one gets "admin".
// saved is false when the target login belongs to a viewer; then nothing changes.
export async function setSuperuser(
  db: Db,
  login: string | undefined,
  passwordHash: string,
): Promise<{ saved: boolean; login: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: adminUsers.id, login: adminUsers.login })
      .from(adminUsers)
      .where(eq(adminUsers.role, 'superuser'))
      .for('update');
    const target = login ?? current?.login ?? DEFAULT_SUPERUSER_LOGIN;
    const [owner] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.login, target));
    if (owner && owner.id !== current?.id) return { saved: false, login: target };
    if (current) {
      await tx
        .update(adminUsers)
        .set({ login: target, passwordHash })
        .where(eq(adminUsers.id, current.id));
      await deleteSessionsOfUser(tx, current.id);
    } else {
      await tx.insert(adminUsers).values({ login: target, passwordHash, role: 'superuser' });
    }
    return { saved: true, login: target };
  });
}
```

- [x] **Step 5: Write `src/cli.ts`**

```ts
import { parseArgs } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { hashPassword } from './admin/password.js';
import { LOGIN_PATTERN, setSuperuser } from './admin/users.js';
import { MIN_PASSWORD_LENGTH, requiredEnv } from './config.js';
import { createDb } from './db.js';

const USAGE =
  'Usage: node dist/cli.js superuser set-password [--login <name>] [--password-stdin]';

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { login: { type: 'string' }, 'password-stdin': { type: 'boolean' } },
  });
}

async function readStdinLine(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += String(chunk);
    const end = data.indexOf('\n');
    if (end >= 0) return data.slice(0, end).replace(/\r$/, '');
  }
  return data.replace(/\r$/, '');
}

// Raw mode: the terminal echoes nothing. Enter ends the input, Backspace deletes one character,
// Ctrl+C exits with 130.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(argv: string[]): Promise<number> {
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = args;
  if (positionals.join(' ') !== 'superuser set-password') {
    console.error(USAGE);
    return 1;
  }
  if (values.login !== undefined && !LOGIN_PATTERN.test(values.login)) {
    console.error('The login must have 3 to 64 characters: letters, digits, ".", "_" or "-".');
    return 1;
  }

  let password: string;
  if (values['password-stdin']) {
    password = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) {
      console.error('No terminal is attached. Pipe the password and use --password-stdin.');
      return 2;
    }
    password = await promptHidden('New password: ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('The passwords do not match. Nothing changed.');
      return 1;
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }

  const { db, pool } = createDb(requiredEnv(process.env, 'DATABASE_URL'));
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    const result = await setSuperuser(db, values.login, await hashPassword(password));
    if (!result.saved) {
      console.error(`The login "${result.login}" belongs to a viewer. Nothing changed.`);
      return 1;
    }
    console.log(`Superuser "${result.login}" saved.`);
    return 0;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
```

- [x] **Step 6: Run the test to make sure it passes**

Run: `npm test -- test/integration/admin-cli.test.ts`
Expected: PASS (7 tests).

- [x] **Step 7: Check the build output**

Run: `npm run build`
Expected: `dist/cli.js` exists. (The Dockerfile already copies `src` and runs `npm run build`, so the image contains `dist/cli.js`.)

- [x] **Step 8: Manual check of the hidden prompt** (needs a real terminal and the dev database)

Run: `DATABASE_URL=postgres://b24auth:b24auth@localhost:5432/b24auth npx tsx src/cli.ts superuser set-password`
Expected: two prompts echo nothing; Backspace works; different inputs print "The passwords do not match." with exit code 1; Ctrl+C exits with 130 (`echo $?`).

- [x] **Step 9: Types, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/cli.ts src/admin/users.ts src/admin/sessions.ts test/integration/admin-cli.test.ts
git commit -m "feat(admin): add superuser set-password CLI command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sessions, login, logout and the JSON guard

- [x] Task 4 complete: Sessions, login, logout and the JSON guard

**Covers tasks.md:** 3.1, 3.2, 3.3 (JSON guard, login logging)

**Files:**
- Modify: `package.json`, `package-lock.json` (`@fastify/cookie`)
- Modify: `src/admin/sessions.ts`, `src/admin/users.ts`
- Create: `src/admin/auth.ts`, `src/admin/index.ts`
- Modify: `src/app.ts`, `test/helpers.ts`
- Test: `test/integration/admin-auth.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `DUMMY_HASH` (Task 1); `adminUsers`, `adminSessions`, `AdminRole` (Task 2); `sha256` from `src/tokens.ts`.
- Produces:
  - `src/admin/sessions.ts`: `SESSION_TTL_SECONDS = 43200`; `type AdminUser = { id: number; login: string; role: AdminRole }`; `createSession(db: Db, userId: number): Promise<string>`; `findSession(db: Db, sessionId: string): Promise<AdminUser | null>`; `deleteSession(db: Db, sessionId: string): Promise<void>`; `deleteExpiredSessions(db: Db, now: Date): Promise<void>`.
  - `src/admin/users.ts`: `hasSuperuser(db: Db): Promise<boolean>`; `findUserByLogin(db: Db, login: string): Promise<(AdminUser & { passwordHash: string }) | null>`.
  - `src/admin/auth.ts`: `SESSION_COOKIE = 'b24a_session'`; `jsonGuard` (onRequest hook); `sessionGuard(db: Db)` (preHandler hook); `currentUser(request: FastifyRequest): AdminUser`; `loginRoute(app: FastifyInstance, db: Db): void`; `sessionRoutes(app: FastifyInstance, db: Db): void`. `FastifyRequest.adminUser: AdminUser | null`.
  - `src/admin/index.ts`: `registerAdmin(app: FastifyInstance, deps: { db: Db }): Promise<void>`.
  - `test/helpers.ts`: `SUPERUSER = { login: 'admin', password: 'superuser-pass-123' }`; `createSuperuser(db: Db): Promise<void>`; `loginAs(app: FastifyInstance, login: string, password: string): Promise<string>` (returns the `cookie` header value `b24a_session=<value>`).

- [x] **Step 1: Install the cookie plugin**

Run: `npm install @fastify/cookie@^11`
Expected: `@fastify/cookie` appears in `dependencies`.

- [x] **Step 2: Add the test helpers** to `test/helpers.ts`

Add imports `import { hashPassword } from '../src/admin/password.js';` and `import { adminUsers } from '../src/schema.js';`. Append:

```ts
export const SUPERUSER = { login: 'admin', password: 'superuser-pass-123' } as const;

export async function createSuperuser(db: Db): Promise<void> {
  await db.insert(adminUsers).values({
    login: SUPERUSER.login,
    passwordHash: await hashPassword(SUPERUSER.password),
    role: 'superuser',
  });
}

// Returns the value for a `cookie` request header.
export async function loginAs(app: FastifyInstance, login: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { login, password } });
  const session = res.cookies.find((c) => c.name === 'b24a_session');
  if (res.statusCode !== 200 || !session) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  return `b24a_session=${session.value}`;
}
```

- [x] **Step 3: Write the failing test** `test/integration/admin-auth.test.ts`

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { adminSessions } from '../../src/schema.js';
import {
  createSuperuser,
  loginAs,
  startApp,
  SUPERUSER,
  truncateAll,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
});
afterEach(async () => {
  await t.close();
});

const login = (body: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: '/api/admin/login', payload: body });
const me = (cookie?: string) =>
  t.app.inject({ method: 'GET', url: '/api/admin/me', headers: cookie ? { cookie } : {} });
const logout = (cookie: string) =>
  t.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie }, payload: {} });

it('Login without a superuser returns 503 with the CLI command', async () => {
  const res = await login({ login: 'admin', password: 'any-password-123' });
  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({
    error: 'no_superuser',
    hint: 'docker compose exec app node dist/cli.js superuser set-password',
  });
});

it('A protected route without a session returns 401 and no-store', async () => {
  await createSuperuser(t.db);
  const res = await me();
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: 'unauthorized' });
  expect(res.headers['cache-control']).toBe('no-store');
});

it('A successful login sets the session cookie and stores only its hash', async () => {
  await createSuperuser(t.db);
  const res = await login(SUPERUSER);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ login: 'admin', role: 'superuser' });
  const header = String(res.headers['set-cookie']);
  expect(header).toMatch(/^b24a_session=[A-Za-z0-9_-]{43};/);
  for (const flag of ['Max-Age=43200', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) {
    expect(header).toContain(flag);
  }
  const cookie = header.split(';')[0];
  const res2 = await me(cookie);
  expect(res2.statusCode).toBe(200);
  expect(res2.json()).toEqual({ login: 'admin', role: 'superuser' });
  const [row] = await t.db.select().from(adminSessions);
  expect(row.idHash).toMatch(/^[0-9a-f]{64}$/);
  expect(header).not.toContain(row.idHash);
});

it('A wrong password and an unknown login give the same 401', async () => {
  await createSuperuser(t.db);
  const wrong = await login({ login: 'admin', password: 'wrong-password-1' });
  const unknown = await login({ login: 'nobody', password: 'wrong-password-1' });
  expect(wrong.statusCode).toBe(401);
  expect(unknown.statusCode).toBe(401);
  expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
  expect(unknown.body).toBe(wrong.body);
});

it('An expired session returns 401', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await t.db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) });
  expect((await me(cookie)).statusCode).toBe(401);
});

it('Logout returns 204, clears the cookie and ends the session', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const res = await logout(cookie);
  expect(res.statusCode).toBe(204);
  expect(String(res.headers['set-cookie'])).toContain('b24a_session=;');
  expect((await me(cookie)).statusCode).toBe(401);
});

it('A form-encoded write gets 415 and changes nothing', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'a=1',
  });
  expect(res.statusCode).toBe(415);
  expect(res.json()).toEqual({ error: 'unsupported_media_type' });
  expect((await me(cookie)).statusCode).toBe(200);
});

it('Login events log the login and the IP, and no password or session ID', async () => {
  await createSuperuser(t.db);
  await login({ login: 'admin', password: 'wrong-password-1' });
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await logout(cookie);
  for (const msg of ['admin_login_failed', 'admin_login_succeeded', 'admin_logout']) {
    expect(t.logs.find((l) => l.msg === msg)).toMatchObject({ login: 'admin', ip: '127.0.0.1' });
  }
  const text = JSON.stringify(t.logs);
  expect(text).not.toContain('wrong-password-1');
  expect(text).not.toContain(SUPERUSER.password);
  expect(text).not.toContain(cookie.split('=')[1]);
});
```

- [x] **Step 4: Run the test to make sure it fails**

Run: `npm test -- test/integration/admin-auth.test.ts`
Expected: FAIL, `/api/admin/login` returns 404.

- [x] **Step 5: Complete `src/admin/sessions.ts`**

Replace the imports and add the functions:

```ts
import { randomBytes } from 'node:crypto';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminSessions, adminUsers, type AdminRole } from '../schema.js';
import { sha256 } from '../tokens.js';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type AdminUser = { id: number; login: string; role: AdminRole };

// Returns the cookie value; the database keeps only its SHA-256.
export async function createSession(db: Db, userId: number): Promise<string> {
  const sessionId = randomBytes(32).toString('base64url');
  await db.insert(adminSessions).values({
    idHash: sha256(sessionId),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return sessionId;
}

export async function findSession(db: Db, sessionId: string): Promise<AdminUser | null> {
  const [row] = await db
    .select({ id: adminUsers.id, login: adminUsers.login, role: adminUsers.role })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(and(eq(adminSessions.idHash, sha256(sessionId)), gt(adminSessions.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.idHash, sha256(sessionId)));
}

export async function deleteExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(adminSessions).where(lte(adminSessions.expiresAt, now));
}
```

Keep `DbOrTx` and `deleteSessionsOfUser` from Task 3.

- [x] **Step 6: Add lookups to `src/admin/users.ts`**

Add `import type { AdminUser } from './sessions.js';` and:

```ts
export async function hasSuperuser(db: Db): Promise<boolean> {
  return (await db.$count(adminUsers, eq(adminUsers.role, 'superuser'))) > 0;
}

export async function findUserByLogin(
  db: Db,
  login: string,
): Promise<(AdminUser & { passwordHash: string }) | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      login: adminUsers.login,
      role: adminUsers.role,
      passwordHash: adminUsers.passwordHash,
    })
    .from(adminUsers)
    .where(eq(adminUsers.login, login))
    .limit(1);
  return row ?? null;
}
```

- [x] **Step 7: Write `src/admin/auth.ts`**

```ts
import '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import {
  createSession,
  deleteSession,
  findSession,
  SESSION_TTL_SECONDS,
  type AdminUser,
} from './sessions.js';
import { findUserByLogin, hasSuperuser } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminUser: AdminUser | null;
  }
}

export const SESSION_COOKIE = 'b24a_session';
const NO_SUPERUSER_HINT = 'docker compose exec app node dist/cli.js superuser set-password';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: true,
  } as const;
}

// A browser cannot send a cross-site JSON request without a CORS preflight, and the server
// enables no CORS. Together with SameSite=Strict this blocks CSRF.
export async function jsonGuard(request: FastifyRequest, reply: FastifyReply) {
  const type = request.headers['content-type'] ?? '';
  if (WRITE_METHODS.has(request.method) && !type.startsWith('application/json')) {
    return reply.status(415).send({ error: 'unsupported_media_type' });
  }
}

export function sessionGuard(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    const user = sessionId ? await findSession(db, sessionId) : null;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    request.adminUser = user;
  };
}

export function currentUser(request: FastifyRequest): AdminUser {
  if (!request.adminUser) throw new Error('sessionGuard did not run');
  return request.adminUser;
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['login', 'password'],
    properties: {
      login: { type: 'string', maxLength: 256 },
      password: { type: 'string', maxLength: 256 },
    },
  },
} as const;

export function loginRoute(app: FastifyInstance, db: Db): void {
  app.post<{ Body: { login: string; password: string } }>(
    '/login',
    { schema: loginSchema },
    async (request, reply) => {
      const ip = request.ip;
      if (!(await hasSuperuser(db))) {
        return reply.status(503).send({ error: 'no_superuser', hint: NO_SUPERUSER_HINT });
      }
      const { login, password } = request.body;
      const user = await findUserByLogin(db, login);
      const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !valid) {
        request.log.info({ login, ip }, 'admin_login_failed');
        return reply.status(401).send({ error: 'invalid_credentials' });
      }
      const sessionId = await createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE, sessionId, cookieOptions());
      request.log.info({ login: user.login, ip }, 'admin_login_succeeded');
      return { login: user.login, role: user.role };
    },
  );
}

export function sessionRoutes(app: FastifyInstance, db: Db): void {
  app.post('/logout', async (request, reply) => {
    const user = currentUser(request);
    await deleteSession(db, request.cookies[SESSION_COOKIE] ?? '');
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    request.log.info({ login: user.login, ip: request.ip }, 'admin_logout');
    return reply.status(204).send();
  });
  app.get('/me', async (request) => {
    const { login, role } = currentUser(request);
    return { login, role };
  });
}
```

- [x] **Step 8: Write `src/admin/index.ts`**

```ts
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { jsonGuard, loginRoute, sessionGuard, sessionRoutes } from './auth.js';

export async function registerAdmin(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  await app.register(
    async (admin) => {
      await admin.register(cookie);
      admin.decorateRequest('adminUser', null);
      admin.addHook('onRequest', jsonGuard);
      admin.addHook('onSend', async (_request, reply, payload) => {
        reply.header('cache-control', 'no-store');
        return payload;
      });
      loginRoute(admin, deps.db);
      // Every route in this scope needs a valid session.
      await admin.register(async (authed) => {
        authed.addHook('preHandler', sessionGuard(deps.db));
        sessionRoutes(authed, deps.db);
      });
    },
    { prefix: '/api/admin' },
  );
}
```

- [x] **Step 9: Register the plugin** in `src/app.ts`

Add `import { registerAdmin } from './admin/index.js';` and, before the `registerWeb` line:

```ts
  await registerAdmin(app, deps);
```

- [x] **Step 10: Run the test to make sure it passes**

Run: `npm test -- test/integration/admin-auth.test.ts`
Expected: PASS (8 tests).

- [x] **Step 11: Full suite, types, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [x] **Step 12: Commit**

```bash
git add package.json package-lock.json src/admin src/app.ts test/helpers.ts test/integration/admin-auth.test.ts
git commit -m "feat(admin): add login, logout and sessions under /api/admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Login rate limit, TRUST_PROXY and session cleanup

- [x] Task 5 complete: Login rate limit, TRUST_PROXY and session cleanup

**Covers tasks.md:** 3.3 (rate limit, `TRUST_PROXY`), 3.4

**Files:**
- Create: `src/admin/rateLimit.ts`
- Modify: `src/admin/auth.ts`, `src/admin/index.ts`, `src/config.ts`, `src/app.ts`, `src/server.ts`, `test/helpers.ts`, `.env.example`
- Test: `test/unit/rate-limit.test.ts`, `test/integration/admin-auth.test.ts`

**Interfaces:**
- Consumes: `deleteExpiredSessions` (Task 4), `loginRoute` (Task 4).
- Produces: `type LoginLimiter = { blocked(ip: string): boolean; fail(ip: string): void; reset(ip: string): void }`; `createLoginLimiter(options: { max: number; windowMs: number }): LoginLimiter`. `loginRoute(app: FastifyInstance, db: Db, limiter: LoginLimiter): void` (new third parameter). `Config.trustProxy: boolean`.

- [x] **Step 1: Write the failing unit test** `test/unit/rate-limit.test.ts`

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLoginLimiter } from '../../src/admin/rateLimit.js';

const WINDOW_MS = 15 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

it('Blocks an IP after 5 failures and only that IP', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 4; i++) limiter.fail('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(false);
  limiter.fail('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(true);
  expect(limiter.blocked('10.0.0.2')).toBe(false);
});

it('Forgets failures older than the window', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.fail('10.0.0.1');
  vi.advanceTimersByTime(WINDOW_MS);
  expect(limiter.blocked('10.0.0.1')).toBe(false);
});

it('reset clears the failures of an IP', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.fail('10.0.0.1');
  limiter.reset('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(false);
});
```

- [x] **Step 2: Add the failing integration tests** to `test/integration/admin-auth.test.ts`

Add `import { deleteExpiredSessions } from '../../src/admin/sessions.js';` and `import { eq } from 'drizzle-orm';`, then append:

```ts
it('The sixth login after five failures gets 429 without a password check', async () => {
  await createSuperuser(t.db);
  for (let i = 0; i < 5; i++) {
    expect((await login({ login: 'admin', password: `wrong-password-${i}` })).statusCode).toBe(401);
  }
  const res = await login(SUPERUSER);
  expect(res.statusCode).toBe(429);
  expect(res.json()).toEqual({ error: 'too_many_attempts' });
});

it('A successful login clears earlier failures', async () => {
  await createSuperuser(t.db);
  for (let i = 0; i < 4; i++) await login({ login: 'admin', password: `wrong-password-${i}` });
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  for (let i = 0; i < 4; i++) {
    expect((await login({ login: 'admin', password: `wrong-password-${i}` })).statusCode).toBe(401);
  }
});

it('deleteExpiredSessions deletes only expired sessions', async () => {
  await createSuperuser(t.db);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const [first] = await t.db.select().from(adminSessions).limit(1);
  await t.db
    .update(adminSessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(adminSessions.idHash, first.idHash));
  await deleteExpiredSessions(t.db, new Date());
  expect(await t.db.$count(adminSessions)).toBe(1);
});
```

- [x] **Step 3: Run the tests to make sure they fail**

Run: `npm test -- test/unit/rate-limit.test.ts test/integration/admin-auth.test.ts`
Expected: FAIL: `rateLimit.js` does not exist; the sixth login returns 200, not 429.

- [x] **Step 4: Write `src/admin/rateLimit.ts`**

```ts
export type LoginLimiter = {
  blocked: (ip: string) => boolean;
  fail: (ip: string) => void;
  reset: (ip: string) => void;
};

// In memory, one instance per app: a restart resets it, and several instances do not share it.
export function createLoginLimiter(options: { max: number; windowMs: number }): LoginLimiter {
  const failures = new Map<string, number[]>();
  const recent = (ip: string, now: number): number[] =>
    (failures.get(ip) ?? []).filter((time) => now - time < options.windowMs);

  return {
    blocked: (ip) => {
      const times = recent(ip, Date.now());
      if (times.length === 0) failures.delete(ip);
      else failures.set(ip, times);
      return times.length >= options.max;
    },
    fail: (ip) => {
      const now = Date.now();
      // The sweep keeps memory bounded by the IPs that failed within the window.
      for (const [key, times] of failures) {
        if (times.every((time) => now - time >= options.windowMs)) failures.delete(key);
      }
      failures.set(ip, [...recent(ip, now), now]);
    },
    reset: (ip) => {
      failures.delete(ip);
    },
  };
}
```

- [x] **Step 5: Use the limiter in the login route** (`src/admin/auth.ts`)

Add `import type { LoginLimiter } from './rateLimit.js';`. Change the signature to `export function loginRoute(app: FastifyInstance, db: Db, limiter: LoginLimiter): void`. In the handler:

```ts
      const ip = request.ip;
      if (limiter.blocked(ip)) return reply.status(429).send({ error: 'too_many_attempts' });
      if (!(await hasSuperuser(db))) {
```

In the failure branch, call `limiter.fail(ip);` before the log line. In the success branch, call `limiter.reset(ip);` before `createSession`.

- [x] **Step 6: Create the limiter** in `src/admin/index.ts`

```ts
import { createLoginLimiter } from './rateLimit.js';
// ...
export async function registerAdmin(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  const limiter = createLoginLimiter({ max: 5, windowMs: 15 * 60_000 });
  // ...
      loginRoute(admin, deps.db, limiter);
```

- [x] **Step 7: Add `TRUST_PROXY`**

In `src/config.ts`, add `trustProxy: boolean;` to `Config`, and in `loadConfig` add:

```ts
    // Set it only when the proxy sets X-Forwarded-For; request.ip then uses that header.
    trustProxy: env.TRUST_PROXY?.trim() === 'true',
```

In `src/app.ts`, add `trustProxy: deps.config.trustProxy,` to the `Fastify({ ... })` options.

In `test/helpers.ts`, add `trustProxy: false,` to `TEST_CONFIG`.

In `.env.example`, append:

```
# Set to true only when the reverse proxy sets X-Forwarded-For.
TRUST_PROXY=false
```

- [x] **Step 8: Add the hourly session cleanup** in `src/server.ts`

Add `import { deleteExpiredSessions } from './admin/sessions.js';` and extend the interval body:

```ts
const cleanup = setInterval(() => {
  const now = new Date();
  deleteExpiredPairs(db, now).catch((err: unknown) => {
    app.log.error({ err }, 'token_cleanup_failed');
  });
  deleteExpiredSessions(db, now).catch((err: unknown) => {
    app.log.error({ err }, 'session_cleanup_failed');
  });
}, CLEANUP_INTERVAL_MS);
```

- [x] **Step 9: Run the tests to make sure they pass**

Run: `npm test -- test/unit/rate-limit.test.ts test/integration/admin-auth.test.ts`
Expected: PASS (3 + 11 tests).

- [x] **Step 10: Full suite, types, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/admin src/config.ts src/app.ts src/server.ts test .env.example
git commit -m "feat(admin): add login rate limit, TRUST_PROXY and session cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: User management API

- [x] Task 6 complete: User management API

**Covers tasks.md:** 4.1, 4.2, 4.3

**Files:**
- Modify: `src/admin/users.ts`, `src/admin/index.ts`
- Create: `src/admin/usersRoutes.ts`
- Test: `test/integration/admin-users.test.ts`

**Interfaces:**
- Consumes: `generatePassword`, `hashPassword` (Task 1); `deleteSessionsOfUser`, `LOGIN_PATTERN` (Task 3); `currentUser` (Task 4); `SUPERUSER`, `createSuperuser`, `loginAs` (Task 4).
- Produces:
  - `src/admin/users.ts`: `type UserRow = { id: number; login: string; role: AdminRole; createdAt: Date }`; `listUsers(db: Db): Promise<UserRow[]>`; `createViewer(db: Db, login: string, passwordHash: string): Promise<{ id: number; login: string } | null>` (`null` if the login exists); `type ViewerChange = 'ok' | 'not_found' | 'superuser'`; `resetViewerPassword(db: Db, id: number, passwordHash: string): Promise<ViewerChange>`; `deleteViewer(db: Db, id: number): Promise<ViewerChange>`.
  - `src/admin/usersRoutes.ts`: `usersRoutes(app: FastifyInstance, db: Db): Promise<void>`.

- [x] **Step 1: Write the failing tests** — append to `test/integration/admin-users.test.ts`

Extend the helpers import with `createSuperuser, loginAs, SUPERUSER`. Append:

```ts
type Created = { id: number; login: string; password: string };

const send = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({
    method,
    url: `/api/admin${url}`,
    headers: { cookie },
    payload: method === 'GET' ? undefined : (payload ?? {}),
  });

async function superuserCookie(): Promise<string> {
  await createSuperuser(t.db);
  return loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
}

async function createViewer(cookie: string, login = 'viewer1'): Promise<Created> {
  const res = await send(cookie, 'POST', '/users', { login });
  expect(res.statusCode).toBe(201);
  return res.json<Created>();
}

it('The superuser creates a viewer who can log in', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  expect(viewer.login).toBe('viewer1');
  expect(viewer.password).toMatch(/^[A-Za-z0-9]{20}$/);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  expect((await send(cookie, 'GET', '/me')).json()).toEqual({ login: 'viewer1', role: 'viewer' });

  const list = (await send(su, 'GET', '/users')).json<Record<string, unknown>[]>();
  expect(list.map((u) => [u.login, u.role])).toEqual([
    ['admin', 'superuser'],
    ['viewer1', 'viewer'],
  ]);
  expect(Object.keys(list[1]).sort()).toEqual(['createdAt', 'id', 'login', 'role']);
});

it('A password reset returns a new password and ends the old sessions', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const oldCookie = await loginAs(t.app, viewer.login, viewer.password);

  const res = await send(su, 'POST', `/users/${viewer.id}/password`);
  expect(res.statusCode).toBe(200);
  const { password } = res.json<{ password: string }>();
  expect(password).toMatch(/^[A-Za-z0-9]{20}$/);
  expect(password).not.toBe(viewer.password);

  expect((await send(oldCookie, 'GET', '/me')).statusCode).toBe(401);
  const oldLogin = await t.app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { login: viewer.login, password: viewer.password },
  });
  expect(oldLogin.statusCode).toBe(401);
  await loginAs(t.app, viewer.login, password);
});

it('Delete ends the session of the viewer', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  expect((await send(su, 'DELETE', `/users/${viewer.id}`)).statusCode).toBe(204);
  expect((await send(cookie, 'GET', '/me')).statusCode).toBe(401);
  expect((await send(su, 'GET', '/users')).json()).toHaveLength(1);
});

it('A viewer gets 403 on every user route', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  const calls = [
    send(cookie, 'GET', '/users'),
    send(cookie, 'POST', '/users', { login: 'viewer2' }),
    send(cookie, 'POST', `/users/${viewer.id}/password`),
    send(cookie, 'DELETE', `/users/${viewer.id}`),
  ];
  for (const res of await Promise.all(calls)) {
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  }
  expect(await t.db.$count(adminUsers)).toBe(2);
});

it('The panel cannot change the superuser', async () => {
  const su = await superuserCookie();
  const [admin] = (await send(su, 'GET', '/users')).json<{ id: number }[]>();
  expect((await send(su, 'POST', `/users/${admin.id}/password`)).statusCode).toBe(403);
  expect((await send(su, 'DELETE', `/users/${admin.id}`)).statusCode).toBe(403);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
});

it('Invalid login 400, duplicate login 409, missing user 404', async () => {
  const su = await superuserCookie();
  await createViewer(su);
  const invalid = await send(su, 'POST', '/users', { login: 'a b' });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toEqual({ error: 'invalid_login' });
  const duplicate = await send(su, 'POST', '/users', { login: 'viewer1' });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json()).toEqual({ error: 'login_taken' });
  expect((await send(su, 'POST', '/users/999/password')).statusCode).toBe(404);
  expect((await send(su, 'DELETE', '/users/999')).statusCode).toBe(404);
});

it('A form-encoded POST /users gets 415 and creates nothing', async () => {
  const su = await superuserCookie();
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: su, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'login=intruder',
  });
  expect(res.statusCode).toBe(415);
  expect(await t.db.$count(adminUsers)).toBe(1);
});
```

- [x] **Step 2: Run the tests to make sure they fail**

Run: `npm test -- test/integration/admin-users.test.ts`
Expected: FAIL, `/api/admin/users` returns 404.

- [x] **Step 3: Add the data access** to `src/admin/users.ts`

Change the drizzle import to `import { asc, eq } from 'drizzle-orm';` and the schema import to `import { adminUsers, type AdminRole } from '../schema.js';`. Append:

```ts
export type UserRow = { id: number; login: string; role: AdminRole; createdAt: Date };

export async function listUsers(db: Db): Promise<UserRow[]> {
  return db
    .select({
      id: adminUsers.id,
      login: adminUsers.login,
      role: adminUsers.role,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(asc(adminUsers.role), asc(adminUsers.id)); // 'superuser' sorts before 'viewer'
}

export async function createViewer(
  db: Db,
  login: string,
  passwordHash: string,
): Promise<{ id: number; login: string } | null> {
  const [row] = await db
    .insert(adminUsers)
    .values({ login, passwordHash, role: 'viewer' })
    .onConflictDoNothing({ target: adminUsers.login })
    .returning({ id: adminUsers.id, login: adminUsers.login });
  return row ?? null;
}

export type ViewerChange = 'ok' | 'not_found' | 'superuser';

export async function resetViewerPassword(
  db: Db,
  id: number,
  passwordHash: string,
): Promise<ViewerChange> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .for('update');
    if (!user) return 'not_found';
    if (user.role === 'superuser') return 'superuser';
    await tx.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, id));
    await deleteSessionsOfUser(tx, id);
    return 'ok';
  });
}

// The foreign key cascade deletes the sessions of the viewer.
export async function deleteViewer(db: Db, id: number): Promise<ViewerChange> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .for('update');
    if (!user) return 'not_found';
    if (user.role === 'superuser') return 'superuser';
    await tx.delete(adminUsers).where(eq(adminUsers.id, id));
    return 'ok';
  });
}
```

- [x] **Step 4: Write `src/admin/usersRoutes.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db.js';
import { currentUser } from './auth.js';
import { generatePassword, hashPassword } from './password.js';
import {
  createViewer,
  deleteViewer,
  listUsers,
  LOGIN_PATTERN,
  resetViewerPassword,
  type ViewerChange,
} from './users.js';

const idParams = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1 } },
  },
} as const;

const createSchema = {
  body: {
    type: 'object',
    required: ['login'],
    properties: { login: { type: 'string', maxLength: 256 } },
  },
} as const;

// Returns the reply for a refused change, or null when the change was made.
function refused(reply: FastifyReply, result: ViewerChange): FastifyReply | null {
  if (result === 'not_found') return reply.status(404).send({ error: 'not_found' });
  if (result === 'superuser') return reply.status(403).send({ error: 'forbidden' });
  return null;
}

// Passwords appear only in the create and reset responses; nothing logs them.
export async function usersRoutes(app: FastifyInstance, db: Db): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      if (currentUser(request).role !== 'superuser') {
        return reply.status(403).send({ error: 'forbidden' });
      }
    });

    scope.get('/users', async () => listUsers(db));

    scope.post<{ Body: { login: string } }>(
      '/users',
      { schema: createSchema },
      async (request, reply) => {
        const { login } = request.body;
        if (!LOGIN_PATTERN.test(login)) return reply.status(400).send({ error: 'invalid_login' });
        const password = generatePassword();
        const created = await createViewer(db, login, await hashPassword(password));
        if (!created) return reply.status(409).send({ error: 'login_taken' });
        return reply.status(201).send({ ...created, password });
      },
    );

    scope.post<{ Params: { id: number } }>(
      '/users/:id/password',
      { schema: idParams },
      async (request, reply) => {
        const password = generatePassword();
        const result = await resetViewerPassword(db, request.params.id, await hashPassword(password));
        return refused(reply, result) ?? { password };
      },
    );

    scope.delete<{ Params: { id: number } }>(
      '/users/:id',
      { schema: idParams },
      async (request, reply) => {
        const result = await deleteViewer(db, request.params.id);
        return refused(reply, result) ?? reply.status(204).send();
      },
    );
  });
}
```

- [x] **Step 5: Register the routes** in `src/admin/index.ts`

Add `import { usersRoutes } from './usersRoutes.js';` and, in the `authed` scope after `sessionRoutes(authed, deps.db);`:

```ts
        await usersRoutes(authed, deps.db);
```

- [x] **Step 6: Run the tests to make sure they pass**

Run: `npm test -- test/integration/admin-users.test.ts`
Expected: PASS (9 tests).

- [x] **Step 7: Full suite, types, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/admin test/integration/admin-users.test.ts
git commit -m "feat(admin): add viewer management API for the superuser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Filter helper, portals and applications

- [x] Task 7 complete: Filter helper, portals and applications

**Covers tasks.md:** 5.1, 5.2 (portals, applications), 5.3

**Files:**
- Create: `src/admin/filters.ts`, `src/admin/dataRoutes.ts`
- Modify: `src/admin/index.ts`
- Test: `test/unit/filters.test.ts`, `test/integration/admin-data.test.ts`

**Interfaces:**
- Consumes: `createSuperuser`, `loginAs`, `registerPortal`, `addApp` (helpers).
- Produces:
  - `src/admin/filters.ts`: `PAGE_SIZE = 50`; `type FilterType = 'text' | 'id' | 'date' | 'enum' | 'none'`; `type Column = { key: string; sql: SQL | AnyColumn; filter: FilterType; values?: readonly string[] }`; `type ParsedQuery = { ok: true; where: SQL | undefined; page: number; offset: number } | { ok: false; column: string }`; `escapeLike(value: string): string`; `parseQuery(columns: readonly Column[], query: Record<string, unknown>): ParsedQuery`; `selection(columns: readonly Column[]): Record<string, SQL | AnyColumn>`.
  - `src/admin/dataRoutes.ts`: `dataRoutes(app: FastifyInstance, db: Db): void` with `GET /portals` and `GET /applications` (Task 8 adds `/tokens` and `/events`).

- [x] **Step 1: Write the failing unit test** `test/unit/filters.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { escapeLike, parseQuery, type Column } from '../../src/admin/filters.js';

const COLUMNS: readonly Column[] = [
  { key: 'id', sql: sql`id`, filter: 'id' },
  { key: 'name', sql: sql`name`, filter: 'text' },
  { key: 'state', sql: sql`state`, filter: 'enum', values: ['active', 'expired'] },
  { key: 'createdAt', sql: sql`created_at`, filter: 'date' },
];

it('escapeLike escapes backslash, percent and underscore', () => {
  expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
});

it('No filters give no condition and page 1', () => {
  expect(parseQuery(COLUMNS, {})).toEqual({ ok: true, where: undefined, page: 1, offset: 0 });
});

it('Unknown keys and empty values are ignored', () => {
  const parsed = parseQuery(COLUMNS, { 'filter[other]': 'x', 'filter[name]': '', foo: 'bar' });
  expect(parsed).toMatchObject({ ok: true, where: undefined });
});

it('Valid filters give a condition', () => {
  const parsed = parseQuery(COLUMNS, {
    'filter[id]': '5',
    'filter[name]': 'x',
    'filter[state]': 'active',
    'filter[createdAt.from]': '2026-01-01',
    'filter[createdAt.to]': '2026-01-02T10:00:00Z',
  });
  expect(parsed.ok).toBe(true);
  expect(parsed.ok && parsed.where).toBeTruthy();
});

it('Invalid id, enum or date values name the column', () => {
  expect(parseQuery(COLUMNS, { 'filter[id]': 'abc' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[id]': '1.5' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[state]': 'old' })).toEqual({ ok: false, column: 'state' });
  expect(parseQuery(COLUMNS, { 'filter[createdAt.from]': 'yesterday' })).toEqual({
    ok: false,
    column: 'createdAt',
  });
});

it('The page is 1-based and invalid pages fall back to 1', () => {
  expect(parseQuery(COLUMNS, { page: '3' })).toMatchObject({ page: 3, offset: 100 });
  expect(parseQuery(COLUMNS, { page: '0' })).toMatchObject({ page: 1, offset: 0 });
  expect(parseQuery(COLUMNS, { page: 'x' })).toMatchObject({ page: 1, offset: 0 });
});
```

- [x] **Step 2: Write the failing integration test** `test/integration/admin-data.test.ts`

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { applications, portals } from '../../src/schema.js';
import {
  addApp,
  createSuperuser,
  loginAs,
  OTHER_PORTAL,
  PORTAL,
  registerPortal,
  startApp,
  SUPERUSER,
  truncateAll,
  type TestApp,
} from '../helpers.js';

type PageBody = {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
};

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
  await createSuperuser(t.db);
  cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
});
afterEach(async () => {
  await t.close();
});

async function list(path: string, query: Record<string, string> = {}, asCookie = cookie) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/admin/${path}`,
    query,
    headers: { cookie: asCookie },
  });
  return { status: res.statusCode, body: res.json<PageBody>(), text: res.body };
}

it('GET /portals returns the documented fields and no secret', async () => {
  const portal = await registerPortal(t.app);
  await addApp(t.app, portal);
  const res = await list('portals');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  const [row] = res.body.rows;
  expect(Object.keys(row).sort()).toEqual(['applications', 'clientId', 'createdAt', 'id', 'origin']);
  expect(row).toMatchObject({ origin: PORTAL, clientId: portal.client_id, applications: 1 });
  const [stored] = await t.db.select({ secretHash: portals.secretHash }).from(portals);
  expect(res.text).not.toMatch(/secret/i);
  expect(res.text).not.toContain(stored.secretHash);
});

it('GET /applications returns the documented fields and no secret', async () => {
  const portal = await registerPortal(t.app);
  const app = await addApp(t.app, portal);
  const res = await list('applications');
  const [row] = res.body.rows;
  expect(Object.keys(row).sort()).toEqual([
    'clientId',
    'createdAt',
    'id',
    'portal',
    'redirectUri',
    'scope',
    'title',
  ]);
  expect(row).toMatchObject({ portal: PORTAL, clientId: app.client_id, title: 'Demo app' });
  const [stored] = await t.db.select({ secretHash: applications.secretHash }).from(applications);
  expect(res.text).not.toMatch(/secret/i);
  expect(res.text).not.toContain(stored.secretHash);
});

it('Data routes need a session', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/admin/portals' });
  expect(res.statusCode).toBe(401);
});

it('Text filters match a case-insensitive substring and combine with AND', async () => {
  const first = await registerPortal(t.app);
  const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
  const fields = { REDIRECT_URI: 'https://app.test/handler', SCOPE: 'crm' };
  await addApp(t.app, first, { ...fields, TITLE: 'Demo app' });
  await addApp(t.app, first, { ...fields, TITLE: 'Other app' });
  await addApp(t.app, second, { ...fields, TITLE: 'Other app' });
  const res = await list('applications', { 'filter[portal]': 'PORTAL.TEST', 'filter[title]': 'other' });
  expect(res.body.total).toBe(1);
  expect(res.body.rows[0]).toMatchObject({ portal: PORTAL, title: 'Other app' });
});

it('An injection string is plain text', async () => {
  await registerPortal(t.app);
  const res = await list('portals', { 'filter[origin]': "' OR 1=1 --" });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 0, rows: [] });
  expect(await t.db.$count(portals)).toBe(1);
});

it('A percent sign in a filter matches a literal percent sign', async () => {
  await t.db.insert(portals).values([
    { origin: 'https://x.test/100%', clientId: 'c1', secretHash: 'x' },
    { origin: 'https://x.test/1000', clientId: 'c2', secretHash: 'x' },
  ]);
  const res = await list('portals', { 'filter[origin]': '100%' });
  expect(res.body.rows.map((r) => r.origin)).toEqual(['https://x.test/100%']);
});

it('An invalid id filter returns 400 with the column', async () => {
  const res = await list('portals', { 'filter[id]': 'abc' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid_filter', column: 'id' });
});

it('A date range includes the whole "to" day', async () => {
  await t.db.insert(portals).values(
    ['2026-01-01', '2026-01-02', '2026-01-03'].map((day, i) => ({
      origin: `https://d${i}.test`,
      clientId: `d${i}`,
      secretHash: 'x',
      createdAt: new Date(`${day}T12:00:00Z`),
    })),
  );
  const res = await list('portals', {
    'filter[createdAt.from]': '2026-01-02',
    'filter[createdAt.to]': '2026-01-02',
  });
  expect(res.body.rows.map((r) => r.origin)).toEqual(['https://d1.test']);
});

it('Pages hold 50 rows, newest first, with the total', async () => {
  const base = Date.parse('2026-01-01T00:00:00Z');
  await t.db.insert(portals).values(
    Array.from({ length: 51 }, (_, i) => ({
      origin: `https://p${i}.test`,
      clientId: `p${i}`,
      secretHash: 'x',
      createdAt: new Date(base + i * 60_000),
    })),
  );
  const first = await list('portals');
  expect(first.body).toMatchObject({ total: 51, page: 1, pageSize: 50 });
  expect(first.body.rows).toHaveLength(50);
  expect(first.body.rows[0].origin).toBe('https://p50.test');
  const second = await list('portals', { page: '2' });
  expect(second.body.rows.map((r) => r.origin)).toEqual(['https://p0.test']);
  const beyond = await list('portals', { page: '3' });
  expect(beyond.body).toMatchObject({ total: 51, page: 3, rows: [] });
});
```

- [x] **Step 3: Run the tests to make sure they fail**

Run: `npm test -- test/unit/filters.test.ts test/integration/admin-data.test.ts`
Expected: FAIL: `filters.js` does not exist; `/api/admin/portals` returns 404.

- [x] **Step 4: Write `src/admin/filters.ts`**

```ts
import { and, ilike, sql, type AnyColumn, type SQL } from 'drizzle-orm';

export const PAGE_SIZE = 50;

export type FilterType = 'text' | 'id' | 'date' | 'enum' | 'none';

export type Column = {
  key: string; // query key and JSON field
  sql: SQL | AnyColumn; // Drizzle expression
  filter: FilterType;
  values?: readonly string[]; // enum values
};

export type ParsedQuery =
  | { ok: true; where: SQL | undefined; page: number; offset: number }
  | { ok: false; column: string };

// At most 9 digits: fits the int4 user_id column and every realistic bigserial id.
const ID_PATTERN = /^(0|[1-9]\d{0,8})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// Repeated keys arrive as arrays; only a single non-empty string counts.
function param(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function validDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

// A date-only "to" includes the whole day: compare with the start of the next day.
function upperBound(value: string): string {
  if (value.length !== 10) return value;
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Every value goes to PostgreSQL as a bound parameter.
export function parseQuery(columns: readonly Column[], query: Record<string, unknown>): ParsedQuery {
  const conditions: SQL[] = [];
  for (const column of columns) {
    const name = `filter[${column.key}]`;
    if (column.filter === 'text') {
      const value = param(query, name);
      if (value !== undefined) conditions.push(ilike(column.sql, `%${escapeLike(value)}%`));
    } else if (column.filter === 'id') {
      const value = param(query, name);
      if (value === undefined) continue;
      if (!ID_PATTERN.test(value)) return { ok: false, column: column.key };
      conditions.push(sql`${column.sql} = ${Number(value)}`);
    } else if (column.filter === 'enum') {
      const value = param(query, name);
      if (value === undefined) continue;
      if (!column.values?.includes(value)) return { ok: false, column: column.key };
      conditions.push(sql`${column.sql} = ${value}`);
    } else if (column.filter === 'date') {
      const from = param(query, `filter[${column.key}.from]`);
      const to = param(query, `filter[${column.key}.to]`);
      if ((from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to))) {
        return { ok: false, column: column.key };
      }
      if (from !== undefined) conditions.push(sql`${column.sql} >= ${from}`);
      if (to !== undefined) conditions.push(sql`${column.sql} < ${upperBound(to)}`);
    }
  }
  const requested = Number(param(query, 'page') ?? '1');
  const page = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;
  return {
    ok: true,
    where: conditions.length > 0 ? and(...conditions) : undefined,
    page,
    offset: (page - 1) * PAGE_SIZE,
  };
}

export function selection(columns: readonly Column[]): Record<string, SQL | AnyColumn> {
  return Object.fromEntries(columns.map((column) => [column.key, column.sql]));
}
```

- [x] **Step 5: Write `src/admin/dataRoutes.ts`** (portals and applications)

```ts
import { count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db.js';
import { applications, portals } from '../schema.js';
import { PAGE_SIZE, parseQuery, selection, type Column } from './filters.js';

type Query = { Querystring: Record<string, unknown> };

// The select lists name each field. No query selects secret_hash, access_hash, refresh_hash
// or params.
const PORTAL_COLUMNS: readonly Column[] = [
  { key: 'id', sql: portals.id, filter: 'id' },
  { key: 'origin', sql: portals.origin, filter: 'text' },
  { key: 'clientId', sql: portals.clientId, filter: 'text' },
  {
    key: 'applications',
    sql: sql<number>`(select count(*)::int from ${applications} where ${applications.portalId} = ${portals.id})`,
    filter: 'none',
  },
  { key: 'createdAt', sql: portals.createdAt, filter: 'date' },
];

const APPLICATION_COLUMNS: readonly Column[] = [
  { key: 'id', sql: applications.id, filter: 'id' },
  { key: 'portal', sql: portals.origin, filter: 'text' },
  { key: 'clientId', sql: applications.clientId, filter: 'text' },
  { key: 'title', sql: applications.title, filter: 'text' },
  { key: 'redirectUri', sql: applications.redirectUri, filter: 'text' },
  { key: 'scope', sql: applications.scope, filter: 'text' },
  { key: 'createdAt', sql: applications.createdAt, filter: 'date' },
];

function invalidFilter(reply: FastifyReply, column: string): FastifyReply {
  return reply.status(400).send({ error: 'invalid_filter', column });
}

// Read-only: this module registers GET routes only.
export function dataRoutes(app: FastifyInstance, db: Db): void {
  app.get<Query>('/portals', async (request, reply) => {
    const q = parseQuery(PORTAL_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(PORTAL_COLUMNS))
        .from(portals)
        .where(q.where)
        .orderBy(desc(portals.createdAt), desc(portals.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db.select({ total: count() }).from(portals).where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get<Query>('/applications', async (request, reply) => {
    const q = parseQuery(APPLICATION_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(APPLICATION_COLUMNS))
        .from(applications)
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where)
        .orderBy(desc(applications.createdAt), desc(applications.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(applications)
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });
}
```

If TypeScript rejects `db.select(selection(...))`, type the return of `selection` as `SelectedFields` imported from `drizzle-orm/pg-core` (do not add a cast to `any`).

- [x] **Step 6: Register the routes** in `src/admin/index.ts`

Add `import { dataRoutes } from './dataRoutes.js';` and, in the `authed` scope after `sessionRoutes(authed, deps.db);`:

```ts
        dataRoutes(authed, deps.db);
```

- [x] **Step 7: Run the tests to make sure they pass**

Run: `npm test -- test/unit/filters.test.ts test/integration/admin-data.test.ts`
Expected: PASS (6 + 9 tests).

- [x] **Step 8: Full suite, types, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/admin test/unit/filters.test.ts test/integration/admin-data.test.ts
git commit -m "feat(admin): add filtered portals and applications endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Tokens and event counters endpoints

- [x] Task 8 complete: Tokens and event counters endpoints

**Covers tasks.md:** 5.2 (tokens, events), 5.3

**Files:**
- Modify: `src/admin/dataRoutes.ts`
- Test: `test/integration/admin-data.test.ts`

**Interfaces:**
- Consumes: `parseQuery`, `selection`, `PAGE_SIZE`, `Column` (Task 7); `authorize`, `utcDay` (helpers / `src/eventCounters.ts`).
- Produces: `GET /api/admin/tokens` and `GET /api/admin/events`.

- [x] **Step 1: Write the failing tests** — append to `test/integration/admin-data.test.ts`

Add to the imports: `eq` from `drizzle-orm`; `eventCounters`, `tokenPairs` from `../../src/schema.js`; `authorize` from `../helpers.js`. Append:

```ts
async function seedTokens() {
  const first = await registerPortal(t.app);
  const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
  const firstApp = await addApp(t.app, first);
  const secondApp = await addApp(t.app, second);
  const issued = await authorize(t.app, first, firstApp.client_id); // LOCAL_USER 5
  await authorize(t.app, first, firstApp.client_id, { PARAMS: { LOCAL_USER: '7' } });
  await authorize(t.app, second, secondApp.client_id); // LOCAL_USER 5
  return { issued, firstApp };
}

it('GET /tokens returns metadata and no token, hash or params', async () => {
  const { issued, firstApp } = await seedTokens();
  const res = await list('tokens', { 'filter[userId]': '7' });
  expect(res.body.total).toBe(1);
  const [row] = res.body.rows;
  expect(Object.keys(row).sort()).toEqual([
    'accessExpiresAt',
    'application',
    'clientId',
    'createdAt',
    'id',
    'portal',
    'refreshExpiresAt',
    'scope',
    'state',
    'userId',
  ]);
  expect(row).toMatchObject({
    portal: PORTAL,
    application: 'Demo app',
    clientId: firstApp.client_id,
    userId: 7,
    state: 'active',
  });
  const all = await list('tokens');
  for (const word of [/hash/i, /params/i, /secret/i, /TZ_OFFSET/, /LOCAL_USER/]) {
    expect(all.text).not.toMatch(word);
  }
  expect(all.text).not.toContain(issued.access_token);
  expect(all.text).not.toContain(issued.refresh_token);
  for (const pair of await t.db.select().from(tokenPairs)) {
    expect(all.text).not.toContain(pair.accessHash);
    expect(all.text).not.toContain(pair.refreshHash);
  }
});

it('Tokens filter by portal origin and user ID together', async () => {
  await seedTokens();
  const res = await list('tokens', { 'filter[portal]': 'portal.test', 'filter[userId]': '5' });
  expect(res.body.total).toBe(1);
  expect(res.body.rows[0]).toMatchObject({ portal: PORTAL, userId: 5 });
});

it('The token state filter uses the access token expiry', async () => {
  await seedTokens();
  const [first] = await t.db.select({ id: tokenPairs.id }).from(tokenPairs).limit(1);
  await t.db
    .update(tokenPairs)
    .set({ accessExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(tokenPairs.id, first.id));
  const expired = await list('tokens', { 'filter[state]': 'expired' });
  expect(expired.body.rows.map((r) => [r.id, r.state])).toEqual([[first.id, 'expired']]);
  expect((await list('tokens', { 'filter[state]': 'active' })).body.total).toBe(2);
  const bad = await list('tokens', { 'filter[state]': 'old' });
  expect(bad.status).toBe(400);
  expect(bad.body).toEqual({ error: 'invalid_filter', column: 'state' });
});

it('GET /events filters by outcome and day, newest day first', async () => {
  await t.db.insert(eventCounters).values([
    { day: '2026-01-01', outcome: 'delivered', count: 3 },
    { day: '2026-01-02', outcome: 'delivered', count: 4 },
    { day: '2026-01-02', outcome: 'failed', count: 1 },
    { day: '2026-01-03', outcome: 'dropped', count: 2 },
  ]);
  const all = await list('events');
  expect(Object.keys(all.body.rows[0]).sort()).toEqual(['count', 'day', 'outcome']);
  expect(all.body.rows.map((r) => r.day)).toEqual([
    '2026-01-03',
    '2026-01-02',
    '2026-01-02',
    '2026-01-01',
  ]);
  const delivered = await list('events', {
    'filter[outcome]': 'delivered',
    'filter[day.from]': '2026-01-02',
  });
  expect(delivered.body.rows).toEqual([{ day: '2026-01-02', outcome: 'delivered', count: 4 }]);
});

it('A viewer reads the tokens table', async () => {
  await seedTokens();
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: { login: 'viewer1' },
  });
  const viewer = created.json<{ login: string; password: string }>();
  const viewerCookie = await loginAs(t.app, viewer.login, viewer.password);
  const res = await list('tokens', {}, viewerCookie);
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(3);
});

it('The data API has no write routes', async () => {
  await seedTokens();
  const res = await t.app.inject({
    method: 'DELETE',
    url: '/api/admin/tokens/1',
    headers: { cookie },
    payload: {},
  });
  expect(res.statusCode).toBe(404);
  expect(await t.db.$count(tokenPairs)).toBe(3);
});
```

- [x] **Step 2: Run the tests to make sure they fail**

Run: `npm test -- test/integration/admin-data.test.ts`
Expected: FAIL, `/api/admin/tokens` and `/api/admin/events` return 404.

- [x] **Step 3: Add the endpoints** to `src/admin/dataRoutes.ts`

Change the imports to `import { asc, count, desc, eq, sql } from 'drizzle-orm';` and `import { applications, eventCounters, portals, tokenPairs } from '../schema.js';`. Add the column lists:

```ts
const TOKEN_COLUMNS: readonly Column[] = [
  { key: 'id', sql: tokenPairs.id, filter: 'id' },
  { key: 'portal', sql: portals.origin, filter: 'text' },
  { key: 'application', sql: applications.title, filter: 'text' },
  { key: 'clientId', sql: applications.clientId, filter: 'text' },
  { key: 'userId', sql: tokenPairs.userId, filter: 'id' },
  { key: 'scope', sql: tokenPairs.scope, filter: 'text' },
  { key: 'createdAt', sql: tokenPairs.createdAt, filter: 'date' },
  { key: 'accessExpiresAt', sql: tokenPairs.accessExpiresAt, filter: 'date' },
  { key: 'refreshExpiresAt', sql: tokenPairs.refreshExpiresAt, filter: 'date' },
  // The state uses the access token expiry; the hourly cleanup deletes pairs with an expired
  // refresh token.
  {
    key: 'state',
    sql: sql<string>`case when ${tokenPairs.accessExpiresAt} > now() then 'active' else 'expired' end`,
    filter: 'enum',
    values: ['active', 'expired'],
  },
];

const EVENT_COLUMNS: readonly Column[] = [
  { key: 'day', sql: eventCounters.day, filter: 'date' },
  {
    key: 'outcome',
    sql: eventCounters.outcome,
    filter: 'enum',
    values: ['delivered', 'failed', 'dropped'],
  },
  { key: 'count', sql: eventCounters.count, filter: 'none' },
];
```

Add inside `dataRoutes`:

```ts
  app.get<Query>('/tokens', async (request, reply) => {
    const q = parseQuery(TOKEN_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(TOKEN_COLUMNS))
        .from(tokenPairs)
        .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where)
        .orderBy(desc(tokenPairs.createdAt), desc(tokenPairs.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(tokenPairs)
        .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });

  // event_counters has no id column; outcome breaks ties within a day.
  app.get<Query>('/events', async (request, reply) => {
    const q = parseQuery(EVENT_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(EVENT_COLUMNS))
        .from(eventCounters)
        .where(q.where)
        .orderBy(desc(eventCounters.day), asc(eventCounters.outcome))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db.select({ total: count() }).from(eventCounters).where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });
```

- [x] **Step 4: Run the tests to make sure they pass**

Run: `npm test -- test/integration/admin-data.test.ts`
Expected: PASS (15 tests).

- [x] **Step 5: Full suite, types, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/admin/dataRoutes.ts test/integration/admin-data.test.ts
git commit -m "feat(admin): add filtered tokens and event counters endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin routing, login page and layout

- [x] Task 9 complete: Admin routing, login page and layout

**Covers tasks.md:** 6.1, 6.2

**Files:**
- Modify: `src/static.ts`
- Test: `test/integration/static.test.ts`
- Modify: `web/package.json`, `web/package-lock.json`, `web/src/main.tsx`
- Create: `web/src/admin/api.ts`, `web/src/admin/AdminApp.tsx`, `web/src/admin/LoginPage.tsx`, `web/src/admin/Layout.tsx`, `web/src/admin/admin.css`

**Interfaces:**
- Consumes: `Gyroscope` from `web/src/Gyroscope.tsx` (its CSS lives in `status.css`, which `main.tsx` loads); `/api/admin/login`, `/logout`, `/me` (Task 4).
- Produces (`web/src/admin/api.ts`): `type Role = 'superuser' | 'viewer'`; `type AdminUser = { login: string; role: Role }`; `type ApiErrorBody = { error: string; hint?: string; column?: string }`; `class ApiError extends Error { status: number; body: ApiErrorBody }`; `setUnauthorizedHandler(handler: () => void): void`; `apiGet<T>(path: string, query?: URLSearchParams): Promise<T>`; `apiSend<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>`. `AdminApp` (named export) with nested routes under `Layout` (`<Outlet />`).

- [x] **Step 1: Write the failing server test** — append to `test/integration/static.test.ts`

```ts
it('GET /admin and /admin/* return index.html with the security headers', async () => {
  for (const url of ['/admin', '/admin/', '/admin/tokens', '/admin/users/42']) {
    const res = await t.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['cache-control']).toBe('no-cache');
  }
});

it('Unknown paths under /api/admin keep the JSON 404', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/admin/nothing' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
});
```

- [x] **Step 2: Run it to make sure it fails**

Run: `npm test -- test/integration/static.test.ts`
Expected: FAIL, `/admin` returns 404.

- [x] **Step 3: Serve `index.html` for the admin paths** in `src/static.ts`

Replace the last line of `registerWeb` with:

```ts
  const sendIndex = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.sendFile('index.html');
  app.get('/', sendIndex);
  // React Router handles /admin/* in the browser.
  app.get('/admin', sendIndex);
  app.get('/admin/*', sendIndex);
```

Change the fastify import to `import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';`.

- [x] **Step 4: Run the server test to make sure it passes**

Run: `npm test -- test/integration/static.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Add React Router**

Run: `npm install react-router@^7 --prefix web`
Expected: `react-router` appears in `web/package.json` `dependencies`.

- [x] **Step 6: Route `/` and `/admin/*`** in `web/src/main.tsx`

```tsx
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { StatusPage } from './StatusPage';
import './theme.css';
import './status.css';

// A separate chunk: the status page bundle does not include the admin code.
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StatusPage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```

- [x] **Step 7: Write `web/src/admin/api.ts`**

```ts
export type Role = 'superuser' | 'viewer';
export type AdminUser = { login: string; role: Role };
export type ApiErrorBody = { error: string; hint?: string; column?: string };

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const BASE = '/api/admin';
let unauthorizedHandler: () => void = () => {};

// AdminApp sets this so that a 401 from any call leads to the login page.
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, path: string, query?: URLSearchParams, body?: unknown) {
  const search = query?.toString();
  const res = await fetch(search ? `${BASE}${path}?${search}` : `${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({ error: `http_${res.status}` }))) as unknown;
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') unauthorizedHandler();
    throw new ApiError(res.status, data as ApiErrorBody);
  }
  return data as T;
}

export function apiGet<T>(path: string, query?: URLSearchParams): Promise<T> {
  return request<T>('GET', path, query);
}

// Every write sends JSON, also when there is no data: the server requires application/json.
export function apiSend<T>(method: 'POST' | 'DELETE', path: string, body: unknown = {}): Promise<T> {
  return request<T>(method, path, undefined, body);
}
```

- [x] **Step 8: Write `web/src/admin/LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { Gyroscope } from '../Gyroscope';
import { ApiError, apiSend, type AdminUser, type ApiErrorBody } from './api';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong login or password.',
  too_many_attempts: 'Too many failed attempts. Try again in 15 minutes.',
};

export function LoginPage({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    apiSend<AdminUser>('POST', '/login', { login, password })
      .then(onLogin, (err: unknown) => {
        setError(err instanceof ApiError ? err.body : { error: 'network' });
        setPassword('');
      })
      .finally(() => setBusy(false));
  };

  return (
    <main className="admin-login">
      <Gyroscope state={error ? 'error' : 'ok'} />
      <h1 className="admin-login-title">b24auth-server admin</h1>
      {error?.error === 'no_superuser' && (
        <div className="admin-notice" role="alert">
          <p>No superuser exists yet. Run this command on the server, then log in:</p>
          <pre>
            <code>{error.hint}</code>
          </pre>
        </div>
      )}
      <form className="admin-login-form" onSubmit={submit}>
        <label>
          Login
          <input
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && error.error !== 'no_superuser' && (
          <p className="admin-error" role="alert">
            {MESSAGES[error.error] ?? 'Login failed. Try again.'}
          </p>
        )}
        <button type="submit" className="admin-button" disabled={busy}>
          Log in
        </button>
      </form>
    </main>
  );
}
```

- [x] **Step 9: Write `web/src/admin/Layout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router';
import { apiSend, type AdminUser } from './api';

const LINKS: readonly (readonly [string, string])[] = [
  ['portals', 'Portals'],
  ['applications', 'Applications'],
  ['tokens', 'Tokens'],
  ['events', 'Event counters'],
];

export function Layout({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const links = user.role === 'superuser' ? [...LINKS, ['users', 'Users'] as const] : LINKS;
  const logout = (): void => {
    apiSend('POST', '/logout').finally(onLogout);
  };
  return (
    <div className="admin-shell">
      <nav className="admin-sidebar" aria-label="Admin">
        <span className="admin-brand">b24auth-server</span>
        <ul className="admin-nav">
          {links.map(([path, label]) => (
            <li key={path}>
              <NavLink to={`/admin/${path}`}>{label}</NavLink>
            </li>
          ))}
        </ul>
        <div className="admin-user">
          <span>{user.login}</span>
          <span className="admin-role">{user.role}</span>
          <button type="button" className="admin-button admin-button--ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
```

- [x] **Step 10: Write `web/src/admin/AdminApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { apiGet, setUnauthorizedHandler, type AdminUser } from './api';
import { Layout } from './Layout';
import { LoginPage } from './LoginPage';
import './admin.css';

export function AdminApp() {
  const navigate = useNavigate();
  // undefined: the session check runs; null: no session.
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      navigate('/admin/login', { replace: true });
    });
    apiGet<AdminUser>('/me').then(setUser, () => setUser(null));
  }, [navigate]);

  if (user === undefined) return null;
  if (user === null) {
    return (
      <Routes>
        <Route path="login" element={<LoginPage onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout user={user} onLogout={() => setUser(null)} />}>
        <Route path="portals" element={<h1 className="admin-title">Portals</h1>} />
        <Route path="*" element={<Navigate to="/admin/portals" replace />} />
      </Route>
    </Routes>
  );
}
```

The `portals` route shows only a heading in this task; Task 10 replaces it with the data pages.

- [x] **Step 11: Write `web/src/admin/admin.css`** (tokens from `theme.css`; the reduced-motion block of `theme.css` covers these animations)

```css
.admin-login {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px 16px;
  animation: fade-in var(--dur-base) ease-out both;
}

.admin-login .gyro {
  width: clamp(100px, 20vw, 160px);
}

.admin-login-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.admin-login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(100%, 320px);
}

.admin-login-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.admin-shell input,
.admin-shell select,
.admin-login input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  transition: border-color var(--dur-fast) ease-out;
}

.admin-shell input:focus-visible,
.admin-shell select:focus-visible,
.admin-login input:focus-visible,
.admin-button:focus-visible,
.admin-nav a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.admin-button {
  padding: 8px 14px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) ease-out,
    color var(--dur-fast) ease-out;
}

.admin-button:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
}

.admin-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.admin-button--ghost {
  border-color: var(--border);
  color: var(--text-muted);
}

.admin-error {
  margin: 0;
  color: var(--color-error);
  font-size: 0.875rem;
}

.admin-notice {
  width: min(100%, 520px);
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.admin-notice p {
  margin: 0 0 8px;
}

.admin-notice pre {
  margin: 0;
  overflow-x: auto;
  color: var(--accent);
}

.admin-shell {
  display: flex;
  min-height: 100vh;
}

.admin-sidebar {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 220px;
  flex-shrink: 0;
  padding: 24px 16px;
  border-right: 1px solid var(--border);
  background: var(--surface);
}

.admin-brand {
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.admin-nav a {
  display: block;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--text-muted);
  text-decoration: none;
  transition:
    background-color var(--dur-fast) ease-out,
    color var(--dur-fast) ease-out;
}

.admin-nav a:hover,
.admin-nav a.active {
  background: var(--bg);
  color: var(--text);
}

.admin-user {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  font-size: 0.875rem;
}

.admin-role {
  color: var(--text-muted);
}

.admin-main {
  flex: 1;
  min-width: 0;
  padding: 24px;
  animation: fade-in var(--dur-base) ease-out both;
}

.admin-title {
  margin: 0 0 16px;
  font-size: 1.25rem;
  font-weight: 500;
}

@media (max-width: 719px) {
  .admin-shell {
    flex-direction: column;
  }

  .admin-sidebar {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    width: auto;
    padding: 12px 16px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .admin-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .admin-user {
    flex-direction: row;
    align-items: center;
    margin-top: 0;
    margin-left: auto;
  }

  .admin-main {
    padding: 16px;
  }
}
```

- [x] **Step 12: Check types, build and format**

Run: `npm run web:typecheck && npm run web:build && npm run lint`
Expected: no errors. `web/dist/assets/` contains more than one `.js` file (the lazy `AdminApp` chunk is separate).

- [x] **Step 13: Manual browser check** (dev database running)

1. Start the API: `npm run dev` (with `.env` that has `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST`).
2. Start the UI: `npm run dev --prefix web`, open `http://localhost:5173/admin`.
3. Without a superuser, submit the login form: the page shows the CLI command in a code block and the gyroscope turns red.
4. Run `DATABASE_URL=... npx tsx src/cli.ts superuser set-password`, log in: the sidebar shows the login, the role and Log out; `/` still shows the status page.
5. Narrow the window below 720 px: the sidebar becomes a top bar. Log out: the login page returns.

- [x] **Step 14: Commit**

```bash
git add src/static.ts test/integration/static.test.ts web/package.json web/package-lock.json web/src/main.tsx web/src/admin
git commit -m "feat(web): add admin routing, login page and layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Data table and the four data pages

- [ ] Task 10 complete: Data table and the four data pages

**Covers tasks.md:** 6.3, 6.4 (data pages)

**Files:**
- Create: `web/src/admin/DataTable.tsx`, `web/src/admin/pages.tsx`
- Modify: `web/src/admin/AdminApp.tsx`, `web/src/admin/admin.css`

**Interfaces:**
- Consumes: `apiGet`, `ApiError` (Task 9); `GET /api/admin/portals|applications|tokens|events` with `filter[...]` and `page` (Tasks 7, 8).
- Produces: `type TableColumn = { key: string; label: string; filter: 'text' | 'id' | 'date' | 'enum' | 'none'; values?: readonly string[] }`; `DataTable({ endpoint, columns }: { endpoint: string; columns: readonly TableColumn[] })`; `PortalsPage`, `ApplicationsPage`, `TokensPage`, `EventsPage` in `pages.tsx`.

The URL query of the page is the API query: the table keeps `filter[...]` and `page` in `useSearchParams` and sends the same string to the API.

- [ ] **Step 1: Write `web/src/admin/DataTable.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, apiGet } from './api';

export type TableColumn = {
  key: string;
  label: string;
  filter: 'text' | 'id' | 'date' | 'enum' | 'none';
  values?: readonly string[];
};

type PageData = { rows: Record<string, unknown>[]; total: number; page: number; pageSize: number };

const DEBOUNCE_MS = 300;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return ISO_DATE_TIME.test(text) ? `${text.slice(0, 19).replace('T', ' ')} UTC` : text;
}

// Local draft; the URL changes 300 ms after the last keystroke.
function DebouncedInput(props: {
  label: string;
  value: string;
  numeric: boolean;
  onCommit: (value: string) => void;
}) {
  const { label, value, numeric, onCommit } = props;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onCommit(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // onCommit changes on every render; the timer must restart only on new input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);
  return (
    <input
      aria-label={label}
      inputMode={numeric ? 'numeric' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function FilterCell(props: {
  column: TableColumn;
  params: URLSearchParams;
  onChange: (name: string, value: string) => void;
}) {
  const { column, params, onChange } = props;
  const name = `filter[${column.key}]`;
  if (column.filter === 'text' || column.filter === 'id') {
    return (
      <DebouncedInput
        label={`Filter by ${column.label}`}
        value={params.get(name) ?? ''}
        numeric={column.filter === 'id'}
        onCommit={(value) => onChange(name, value)}
      />
    );
  }
  if (column.filter === 'enum') {
    return (
      <select
        aria-label={`Filter by ${column.label}`}
        value={params.get(name) ?? ''}
        onChange={(e) => onChange(name, e.target.value)}
      >
        <option value="">All</option>
        {column.values?.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  }
  if (column.filter === 'date') {
    const from = `filter[${column.key}.from]`;
    const to = `filter[${column.key}.to]`;
    return (
      <div className="admin-date-range">
        <input
          type="date"
          aria-label={`${column.label} from`}
          value={params.get(from) ?? ''}
          onChange={(e) => onChange(from, e.target.value)}
        />
        <input
          type="date"
          aria-label={`${column.label} to`}
          value={params.get(to) ?? ''}
          onChange={(e) => onChange(to, e.target.value)}
        />
      </div>
    );
  }
  return null;
}

export function DataTable({ endpoint, columns }: { endpoint: string; columns: readonly TableColumn[] }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = params.toString();

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<PageData>(endpoint, new URLSearchParams(query))
      .then(
        (next) => {
          if (!active) return;
          setData(next);
          setError(null);
        },
        (err: unknown) => {
          if (!active) return;
          const column = err instanceof ApiError ? err.body.column : undefined;
          setError(column ? `Invalid filter value in "${column}".` : 'The data could not be loaded.');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, query]);

  // A filter change resets the page to 1.
  const setFilter = (name: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const setPage = (page: number): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(page));
      return next;
    });
  };

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={loading ? 'admin-table-wrap admin-table-wrap--loading' : 'admin-table-wrap'}>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
            <tr className="admin-filter-row">
              {columns.map((column) => (
                <th key={column.key}>
                  <FilterCell column={column} params={params} onChange={setFilter} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row, index) => (
              <tr key={`${page}-${index}`}>
                {columns.map((column) => {
                  const text = display(row[column.key]);
                  return (
                    <td key={column.key} title={text}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="admin-empty">
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-table-footer">
        <span role="status">
          {error ?? (loading ? 'Loading…' : `${data?.total ?? 0} rows · page ${page} of ${pages}`)}
        </span>
        <div className="admin-pager">
          <button
            type="button"
            className="admin-button admin-button--ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="admin-button admin-button--ghost"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
```

`web/` has no ESLint. If `tsc` or Vite complains about the `eslint-disable-next-line` comment, delete the comment and keep the explanation line.

- [ ] **Step 2: Write `web/src/admin/pages.tsx`**

```tsx
import { DataTable, type TableColumn } from './DataTable';

const PORTALS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'origin', label: 'Origin', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'applications', label: 'Applications', filter: 'none' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
];

const APPLICATIONS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'portal', label: 'Portal', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'title', label: 'Title', filter: 'text' },
  { key: 'redirectUri', label: 'Redirect URI', filter: 'text' },
  { key: 'scope', label: 'Scope', filter: 'text' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
];

const TOKENS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'portal', label: 'Portal', filter: 'text' },
  { key: 'application', label: 'Application', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'userId', label: 'User ID', filter: 'id' },
  { key: 'scope', label: 'Scope', filter: 'text' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
  { key: 'accessExpiresAt', label: 'Access expires at', filter: 'date' },
  { key: 'refreshExpiresAt', label: 'Refresh expires at', filter: 'date' },
  { key: 'state', label: 'State', filter: 'enum', values: ['active', 'expired'] },
];

const EVENTS: readonly TableColumn[] = [
  { key: 'day', label: 'Day', filter: 'date' },
  { key: 'outcome', label: 'Outcome', filter: 'enum', values: ['delivered', 'failed', 'dropped'] },
  { key: 'count', label: 'Count', filter: 'none' },
];

export function PortalsPage() {
  return (
    <>
      <h1 className="admin-title">Portals</h1>
      <DataTable endpoint="/portals" columns={PORTALS} />
    </>
  );
}

export function ApplicationsPage() {
  return (
    <>
      <h1 className="admin-title">Applications</h1>
      <DataTable endpoint="/applications" columns={APPLICATIONS} />
    </>
  );
}

export function TokensPage() {
  return (
    <>
      <h1 className="admin-title">Tokens</h1>
      <DataTable endpoint="/tokens" columns={TOKENS} />
    </>
  );
}

export function EventsPage() {
  return (
    <>
      <h1 className="admin-title">Event counters</h1>
      <DataTable endpoint="/events" columns={EVENTS} />
    </>
  );
}
```

- [ ] **Step 3: Register the data routes** in `web/src/admin/AdminApp.tsx`

Add `import { ApplicationsPage, EventsPage, PortalsPage, TokensPage } from './pages';`. Replace the line `<Route path="portals" element={<h1 className="admin-title">Portals</h1>} />` with:

```tsx
        <Route path="portals" element={<PortalsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="events" element={<EventsPage />} />
```

Each route element must remount when the user switches tables, so the table state does not leak between pages. React Router does this already, because each route has a different element type.

- [ ] **Step 4: Add the table styles** — append to `web/src/admin/admin.css`

```css
.admin-table-wrap {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: opacity var(--dur-fast) ease-out;
}

.admin-table-wrap--loading {
  opacity: 0.6;
}

.admin-table-scroll {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.admin-table th,
.admin-table td {
  max-width: 260px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.admin-table th {
  font-weight: 500;
  color: var(--text-muted);
}

.admin-filter-row th {
  padding-top: 4px;
  font-weight: 400;
}

.admin-filter-row input,
.admin-filter-row select {
  width: 100%;
  min-width: 90px;
  padding: 4px 8px;
}

.admin-date-range {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-table tbody tr {
  animation: fade-in var(--dur-base) ease-out both;
  transition: background-color var(--dur-fast) ease-out;
}

.admin-table tbody tr:hover {
  background: var(--bg);
}

.admin-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
}

.admin-table-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.admin-pager {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 5: Check types, build and format**

Run: `npm run web:typecheck && npm run web:build && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual browser check** (as in Task 9, with some data: register a portal and authorize a user with the integration helpers or a real portal)

1. Open `/admin/tokens`: rows fade in; long values end with an ellipsis and show the full value on hover; there is no edit or delete control.
2. Type in the Portal filter: the URL changes about 300 ms after the last key; the page resets to 1.
3. Set State to `expired`, set a date range, combine with User ID: the count changes; an impossible filter shows "No matching rows".
4. Type `abc` into an ID filter: the footer shows the invalid filter message.
5. Reload the page with filters in the URL: the filters stay. Previous and Next move between pages when there are more than 50 rows.
6. With `prefers-reduced-motion: reduce` (browser dev tools), rows appear without animation.

- [ ] **Step 7: Commit**

```bash
git add web/src/admin
git commit -m "feat(web): add filtered data tables for the admin panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Users page

- [ ] Task 11 complete: Users page

**Covers tasks.md:** 6.4 (user management page)

**Files:**
- Create: `web/src/admin/UsersPage.tsx`
- Modify: `web/src/admin/AdminApp.tsx`, `web/src/admin/admin.css`

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `ApiError`, `Role` (Task 9); `/api/admin/users` routes (Task 6).
- Produces: `UsersPage` (named export), registered only for the superuser.

- [ ] **Step 1: Write `web/src/admin/UsersPage.tsx`**

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiGet, apiSend, type Role } from './api';

type UserRow = { id: number; login: string; role: Role; createdAt: string };
type Shown = { login: string; password: string };

const ERRORS: Record<string, string> = {
  invalid_login: 'Use 3 to 64 characters: letters, digits, ".", "_" or "-".',
  login_taken: 'This login already exists.',
};

function message(err: unknown): string {
  return (err instanceof ApiError && ERRORS[err.body.error]) || 'The action failed. Try again.';
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [newLogin, setNewLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    apiGet<UserRow[]>('/users').then(setUsers, () => setError('The user list could not be loaded.'));
  }, []);
  useEffect(load, [load]);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    apiSend<{ id: number; login: string; password: string }>('POST', '/users', { login: newLogin }).then(
      (created) => {
        setShown({ login: created.login, password: created.password });
        setNewLogin('');
        load();
      },
      (err: unknown) => setError(message(err)),
    );
  };

  const reset = (user: UserRow): void => {
    setError(null);
    apiSend<{ password: string }>('POST', `/users/${user.id}/password`).then(
      ({ password }) => setShown({ login: user.login, password }),
      (err: unknown) => setError(message(err)),
    );
  };

  const remove = (user: UserRow): void => {
    if (!window.confirm(`Delete the viewer "${user.login}"? The viewer is logged out at once.`)) return;
    setError(null);
    apiSend('DELETE', `/users/${user.id}`).then(load, (err: unknown) => setError(message(err)));
  };

  const copy = (): void => {
    if (!shown) return;
    navigator.clipboard.writeText(shown.password).then(() => setCopied(true));
  };

  const close = (): void => {
    setShown(null);
    setCopied(false);
  };

  return (
    <>
      <h1 className="admin-title">Users</h1>
      <form className="admin-inline-form" onSubmit={create}>
        <input
          aria-label="Login of the new viewer"
          placeholder="Login"
          value={newLogin}
          onChange={(e) => setNewLogin(e.target.value)}
          required
        />
        <button type="submit" className="admin-button">
          New viewer
        </button>
      </form>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Login</th>
                <th scope="col">Role</th>
                <th scope="col">Created at</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => (
                <tr key={user.id}>
                  <td title={user.login}>{user.login}</td>
                  <td>{user.role}</td>
                  <td>{`${user.createdAt.slice(0, 19).replace('T', ' ')} UTC`}</td>
                  <td className="admin-actions">
                    {user.role === 'viewer' && (
                      <>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          onClick={() => reset(user)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          onClick={() => remove(user)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {shown && (
        <div className="admin-dialog-backdrop">
          <div
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-dialog-title"
          >
            <h2 id="admin-dialog-title">Password for {shown.login}</h2>
            <code className="admin-password">{shown.password}</code>
            <p>This password is shown once.</p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="admin-button admin-button--ghost" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Register the route for the superuser only** in `web/src/admin/AdminApp.tsx`

Add `import { UsersPage } from './UsersPage';`. After the `events` route, add:

```tsx
        {user.role === 'superuser' && <Route path="users" element={<UsersPage />} />}
```

For a viewer, `/admin/users` matches `*` and goes to `/admin/portals`.

- [ ] **Step 3: Add the dialog and form styles** — append to `web/src/admin/admin.css`

```css
.admin-inline-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.admin-actions {
  display: flex;
  gap: 8px;
}

.admin-dialog-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(0 0 0 / 0.6);
  animation: fade-in var(--dur-fast) ease-out both;
}

.admin-dialog {
  width: min(100%, 420px);
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.admin-dialog h2 {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 500;
}

.admin-password {
  display: block;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg);
  color: var(--accent);
  font-size: 1.125rem;
  letter-spacing: 0.05em;
  user-select: all;
}

.admin-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 4: Check types, build and format**

Run: `npm run web:typecheck && npm run web:build && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual browser check** (full UI pass from the Design Doc, section 8)

1. As the superuser, open Users: the superuser row has no action buttons.
2. Create a viewer: the dialog shows a 20-character password, "This password is shown once." and Copy; Copy puts the password in the clipboard; Close removes it, and nothing shows it again.
3. A duplicate login and `a b` show the error texts.
4. In a private window, log in as the viewer: no Users link; `/admin/users` goes to Portals.
5. As the superuser, reset the viewer password: the viewer's next action leads to the login page. Delete the viewer after the confirmation: the same happens.
6. Repeat the narrow layout check below 720 px.

- [ ] **Step 6: Commit**

```bash
git add web/src/admin
git commit -m "feat(web): add the user management page for the superuser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Documentation

- [ ] Task 12 complete: Documentation

**Covers tasks.md:** 7.1, 7.2

**Files:**
- Modify: `docs/deployment.md`, `README.md`

- [ ] **Step 1: Add `TRUST_PROXY`** to the variable table in `docs/deployment.md` section 3

```markdown
| `TRUST_PROXY` | `true` | Optional, default `false`. Set `true` only when the proxy sets `X-Forwarded-For`. The admin login rate limit then uses the client IP from that header |
```

- [ ] **Step 2: Restrict the admin paths at the proxy** — in `docs/deployment.md` section 4, after the first bullet, add:

```markdown
- Allow `/admin`, `/admin/*` and `/api/admin/*` only from the network of the operators. The admin
  panel has a login rate limit and no default password, but it must not be reachable from the
  portal servers, the application servers or the internet.
```

In the nginx example, add before `location / {`:

```
    location ~ ^/(admin|api/admin)(/|$) {
        allow 10.0.0.0/24; # operators
        deny  all;
        proxy_pass http://127.0.0.1:3000;
    }
```

- [ ] **Step 3: Add the admin panel section** to `docs/deployment.md` as section `## 8a. Admin panel` (after section 8)

```markdown
## 8a. Admin panel

The admin panel at `/admin` shows read-only tables of portals, local applications, token
metadata and event counters. It never shows tokens, token hashes, secrets or token parameters.

Set the superuser password before the first login. The server creates no default password:

    docker compose exec app node dist/cli.js superuser set-password

- The command asks for the password twice and shows nothing while you type.
- The password must have at least 12 characters.
- The default login is `admin`. To use another login, add `--login <name>`.
- To set the password from a script, pipe it and add `--password-stdin`:
  `printf '%s\n' "$PASSWORD" | docker compose exec -T app node dist/cli.js superuser set-password --password-stdin`.
- The command never accepts the password as an argument or an environment variable.
- If you run the command again, it replaces the password and ends all sessions of the
  superuser.

The superuser creates viewers in the panel (Users page). The server generates a 20-character
password for each new viewer and for each password reset, and shows it once. A viewer sees the
data tables only. Only the CLI can change the superuser.

Sessions:

- A session ends 12 hours after login. Log out ends it at once.
- The session cookie always has the `Secure` flag. Browsers accept it on `http://localhost`; in production the reverse proxy must serve HTTPS.
  Serve the panel over HTTPS at the proxy.
- After 5 failed logins from one IP address in 15 minutes, the server rejects logins from that
  address for the rest of the window. The limit is in memory: a restart resets it.
- If the proxy does not set `X-Forwarded-For` or `TRUST_PROXY` is `false`, all clients share the
  proxy IP address for this limit.
- The log records each login success, login failure and logout with the login name and the IP
  address. It never records passwords or session IDs.
```

In section 9, add: `- Expired admin sessions are deleted hourly.`

- [ ] **Step 4: Update `README.md`**

1. In the features table, add a row after **Operations** (keep the table format; Prettier aligns it):

```markdown
| **Admin panel** | A multi-user admin panel at `/admin`: read-only, searchable tables of portals, local applications, token metadata (no tokens or hashes) and daily event counters. The superuser password is set only with the CLI; the superuser manages viewers in the panel. Sessions last 12 hours; logins are rate-limited. |
```

2. In the configuration table of the Quick start, add a row:

```markdown
| `TRUST_PROXY` | `true` | Optional. Set `true` only when the proxy sets `X-Forwarded-For`. |
```

3. In "Limitations and roadmap", replace the bullet **Status page only.** with:

```markdown
- **Read-only admin panel.** The admin panel shows data but cannot change portals, applications or tokens. It has no SSO, no two-factor authentication and no audit log. Restrict `/admin` and `/api/admin` at the proxy.
```

and remove "an admin page and" from the roadmap sentence that follows the list.

- [ ] **Step 5: Format and check**

Run: `npx prettier --write README.md && npm run lint`
Expected: no errors (Prettier ignores `docs/`; check the tables in `docs/deployment.md` by eye).

- [ ] **Step 6: Final full check**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run web:typecheck && npm run web:build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add docs/deployment.md README.md
git commit -m "docs: describe the admin panel, superuser setup and TRUST_PROXY

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: every requirement of `admin-auth`, `admin-users` and `admin-data-browser` maps to a test in Tasks 1–8 or to a manual check in Tasks 3, 9–11. The "Visual style" requirement is checked by hand (Task 10 step 6, Task 11 step 5).
- Decisions the Design Doc leaves open, fixed here: the 415 body `unsupported_media_type`; the bodies `invalid_login`, `login_taken`, `not_found`; exit code 1 for an unknown CLI flag; `id` filters accept at most 9 digits; events order `day desc, outcome asc` (no id column).
