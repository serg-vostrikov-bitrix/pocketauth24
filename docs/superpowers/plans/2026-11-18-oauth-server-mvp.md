---
change: oauth-server-mvp
design-doc: docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md
base-ref: 9911496054be6fd9846513a20145e8c841f16192
---

# b24auth-server MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone HTTP service that replaces the Bitrix24 cloud OAuth server for on-premise portals in a closed network: portal registration, local app registry, token issue/check/renewal and best-effort event delivery.

**Architecture:** One Fastify service with three API surfaces (`/oauth/register/`, `/rest/{method}` for the portal, `/oauth/token/` for applications) over one PostgreSQL database accessed directly with Drizzle. A flat layout of ~12 source files; portal RPC methods are a plain object map; token logic lives in `src/tokens.ts`. Responses follow the Bitrix wire shape (`{result}` / `{error, error_description}`).

**Tech Stack:** Node.js 24 LTS, TypeScript (strict, ESM), Fastify 5, @fastify/formbody + qs, Drizzle ORM + drizzle-kit, PostgreSQL 17, Vitest, ESLint (typescript-eslint) + Prettier, Docker (DHI Node base image), GitHub Actions.

## Global Constraints

- Node.js LTS (24), TypeScript `strict: true`, ESM (`"type": "module"`, `module: NodeNext`, relative imports end in `.js`).
- Named exports only. Exception: tool config files that the tool requires to default-export (`eslint.config.js`, `vitest.config.ts`, `drizzle.config.ts`).
- No `any`, no `enum` (use string literal unions). Enforced by ESLint.
- Fastify with `@fastify/formbody` using `qs.parse` with options `{ depth: 20, parameterLimit: 10000, arrayLimit: 1000 }`; Fastify `bodyLimit` 10 MB.
- Drizzle ORM + drizzle-kit migrations; PostgreSQL 17.
- Flat layout exactly as Design Doc section 2: `src/{app,server,config,db,schema,bitrix,tokens}.ts`, `src/routes/{register,rpc,oauthToken}.ts`, `src/methods/{applications,tokens,events}.ts`. No repository layer, no services folder; the method registry is a plain object in `src/routes/rpc.ts`.
- Constants, not config: access token 3600 s, refresh token 180 days, event POST timeout 10 s (10 000 ms), event in-flight cap 200, log level `info`, listen port 3000.
- Config env vars: only `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (all required).
- Refresh tokens are reusable until their own expiry. No install/uninstall methods. No revocation column. Deleting an application cascades its tokens; deleting a portal cascades its applications.
- Tokens and secrets: `randomBytes(32)` hex; only SHA-256 hashes are stored; secret comparison with `crypto.timingSafeEqual`.
- Errors: `{"error": "...", "error_description": "..."}`; validation → 400 `invalid_request`; unknown → 500 `{"error": "internal_error"}`.
- Tests: every spec scenario has exactly one primary integration test via `app.inject()` against real PostgreSQL; the only unit test is the table-driven scope-intersection test; contract tests compare shapes with HAR fixtures; time scenarios use `vi.useFakeTimers({ toFake: ['Date'] })` and expiry is compared in application code (never SQL `now()`).
- Everything written to the repository is in English. Commits use conventional commits.

## tasks.md mapping

| tasks.md | Plan task |
|---|---|
| 1.1 Protocol capture | Task 2 (manual by the user; only Task 14 depends on it) |
| 1.2 Skeleton (+ CTO exception note) | Task 1 |
| 1.3 Container image + compose | Task 3 (database service), Task 13 (image, app service) |
| 1.4 Test runner + CI | Task 1 (Vitest, ESLint, Prettier), Task 3 (DB test setup), Task 13 (CI) |
| 2.1 Schema + migrations | Task 3 |
| 3.1 `/oauth/register/` | Task 3, Task 4 (re-registration scenario needs RPC auth) |
| 3.2 RPC auth, dispatch, helpers | Task 4 |
| 4.1 `application.add` | Task 5 |
| 4.2 `application.update` / `delete` | Task 9 |
| 4.3 `application.list` | Task 4 |
| 5.1 Token generation, hashing, response builder | Task 6 |
| 5.2 `rest.authorize` | Task 6 |
| 5.3 `rest.check` | Task 7 |
| 5.4 `/oauth/token/` | Task 8 |
| 6.1 `rest.event.call` intake, timeout, cap | Task 10, Task 11 |
| 6.2 `auth` block rules | Task 10 (no-user block), Task 12 (user token block) |
| 6.3 Failure logging, no retries | Task 10 |
| 7.1 Contract tests | Task 14 (blocked until Task 2 fixtures exist) |
| 7.2 End-to-end on test portal | Task 15 (manual) |
| 7.3 Deployment guide | Task 16 |

Order: Tasks 1 → 13 are sequential and need no capture. Task 2's capture is done by the user in parallel at any time after Task 1 (Task 2 needs `tsx` from Task 1 for the sanitize step). Task 14 starts once Task 2's fixtures are committed and Task 12 is done. Tasks 15 and 16 come last.

## File map

| File | Responsibility | Created in |
|---|---|---|
| `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `vitest.config.ts`, `README.md` | Tooling, CTO exception note | Task 1 |
| `src/config.ts` | Constants, env parsing | Task 1 |
| `src/app.ts` | `buildApp()`: Fastify, formbody+qs, error handler, routes, `/health` | Task 1 (extended 3, 4, 8) |
| `src/server.ts` | Migrate, listen, hourly cleanup, shutdown | Task 1 (extended 3, 13) |
| `docs/protocol-capture.md`, `scripts/sanitize-har.ts`, `test/fixtures/*.har` | Capture procedure and sanitized fixtures | Task 2 |
| `src/schema.ts`, `src/db.ts`, `drizzle.config.ts`, `drizzle/*` | Tables, pool, migrations | Task 3 |
| `src/bitrix.ts` | `BitrixError`, `fail`, `ok`, `sendError`, method types | Task 3 (extended 4) |
| `src/tokens.ts` | Hashing, scope, token pair issue/check/refresh, cleanup | Task 3 (extended 5, 6, 7, 8, 13) |
| `src/routes/register.ts` | `POST /oauth/register/` | Task 3 |
| `src/routes/rpc.ts` | Portal auth + method map | Task 4 |
| `src/methods/applications.ts` | `application.*` | Task 4 (extended 5, 9) |
| `src/methods/tokens.ts` | `rest.authorize`, `rest.check` | Task 6 (extended 7) |
| `src/routes/oauthToken.ts` | `GET|POST /oauth/token/` | Task 8 |
| `src/methods/events.ts` | `rest.event.call`, `deliver()` | Task 10 (extended 11, 12) |
| `docker-compose.yml` | `db` (Task 3), `app` (Task 13) | Task 3 |
| `Dockerfile`, `.env.example`, `.github/workflows/ci.yml` | Image, env template, CI | Task 13 |
| `test/helpers.ts`, `test/global-setup.ts` | Test app, DB setup, HTTP helpers, handler server | Task 3 (extended 4, 5, 6, 8, 10) |
| `test/integration/*.test.ts` | One test per spec scenario | Tasks 1, 3–12 |
| `test/unit/scope.test.ts` | Scope intersection table | Task 6 |
| `test/contract/cloud-shapes.test.ts` | Shape comparison with HAR fixtures | Task 14 |
| `docs/e2e-checklist.md` | Manual end-to-end checklist | Task 15 |
| `docs/deployment.md` | Deployment guide | Task 16 |

## Scenario → test map

| Spec scenario | Test file | Task |
|---|---|---|
| Allowed portal registers | `test/integration/portal-registration.test.ts` | 3 |
| Unknown portal is rejected | same | 3 |
| Portal re-registers | same | 4 |
| Valid service credentials | same | 4 |
| Invalid service credentials | same | 4 |
| Unknown method | same | 4 |
| Status sync | `test/integration/application-registry.test.ts` | 4 |
| Portal creates a local app | same | 5 |
| Local app is usable immediately | same | 6 |
| Install URL of a local app still runs | no server test (Design Doc §8); proven in Task 15 | 15 |
| Scope update applies to new tokens | same | 9 |
| Delete removes tokens | same | 9 |
| Foreign application | same | 9 |
| Fields present | `test/integration/token-service.test.ts` | 6 |
| App page opens | same | 6 |
| Unknown application | same | 6 |
| Database leak | same | 6 |
| Valid token | same | 7 |
| Unknown or foreign token | same | 7 |
| Expired token | same | 7 |
| Successful renewal | same | 8 |
| Refresh token reused | same | 8 |
| Refresh token expired or unknown | same | 8 |
| Wrong application secret | same | 8 |
| Unsupported grant type | same | 8 |
| Portal hands over events (incl. early `result: true`) | `test/integration/event-delivery.test.ts` | 10 |
| Event without user auth | same | 10 |
| Handler is down | same | 10 |
| Nested `data` deeper than 5 levels (Design Doc §8) | same | 10 |
| Overload | same | 11 |
| Install event reaches a server-side app | same | 12 |

---

### Task 1: Service skeleton, tooling and CTO exception note

- [x] Task 1 complete: Service skeleton, tooling and CTO exception note

tasks.md: **1.2**, part of **1.4**

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `vitest.config.ts`, `README.md`
- Create: `src/config.ts`, `src/app.ts`, `src/server.ts`
- Test: `test/integration/health.test.ts`

**Interfaces:**
- Produces: constants `ACCESS_TTL_SECONDS`, `REFRESH_TTL_SECONDS`, `EVENT_TIMEOUT_MS`, `EVENT_IN_FLIGHT_CAP`, `LOG_LEVEL`, `PORT`, `CLEANUP_INTERVAL_MS`, `BODY_LIMIT_BYTES`, `QS_OPTIONS`; `type Config = { baseUrl: string; databaseUrl: string; portalAllowlist: string[] }`; `loadConfig(env?: NodeJS.ProcessEnv): Config`; `buildApp(deps: { config: Config; logStream?: Writable }): Promise<FastifyInstance>` (Task 3 adds `db`).

- [x] **Step 1: Initialize the package and install dependencies**

```bash
cd /d/Work/projects/b24auth-server
npm init -y
npm pkg set type=module private=true version=0.1.0 engines.node=">=24"
npm pkg set scripts.build="tsc -p tsconfig.build.json" scripts.start="node dist/server.js" scripts.dev="tsx watch src/server.ts" scripts.test="vitest run" scripts.lint="eslint . && prettier --check ." scripts.format="prettier --write ." scripts.typecheck="tsc --noEmit" scripts.db:generate="drizzle-kit generate"
npm pkg delete main
npm install fastify @fastify/formbody qs drizzle-orm pg
npm install -D typescript tsx vitest drizzle-kit @types/node @types/pg @types/qs eslint @eslint/js typescript-eslint eslint-config-prettier prettier
```

- [x] **Step 2: Write tooling config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "test", "scripts", "*.config.ts"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'drizzle', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Fastify handlers and method handlers are async by convention.
      '@typescript-eslint/require-await': 'off',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a string literal union, not enum.' },
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
      ],
    },
  },
  { files: ['*.config.ts', '*.config.js'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
```

`.prettierrc.json`:
```json
{ "singleQuote": true, "printWidth": 100 }
```

`.prettierignore`:
```
dist
drizzle
docs
*.har
package-lock.json
```

`.gitignore`:
```
node_modules
dist
coverage
.env
*.raw.har
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
```

- [x] **Step 3: Write `README.md` with the CTO exception note**

```markdown
# b24auth-server

Replacement for the Bitrix24 cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`)
for on-premise portals in a closed network: portal registration, local applications, token
issue, check and renewal, and event delivery to application handlers.

## Policy exception: Node.js instead of .NET

NTC defaults new projects to .NET. The project owner chose Node.js + TypeScript (Fastify,
Drizzle, PostgreSQL) for this service.

- Status: **pending CTO approval**
- Approved by / date: _to be filled in when the approval is recorded_
- NTC portal task: _link to be added when the approval is recorded_

If the exception is not approved, the design ports to .NET with the same layout
(`docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md`).

## Development

    npm install
    docker compose up -d db
    npm test

Configuration: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (see `.env.example`).
Deployment: `docs/deployment.md`.
```

The "to be filled in" lines are deliberate: the user records the approval (Comet constraint); the agent does not invent it.

- [x] **Step 4: Write the failing health test**

`test/integration/health.test.ts`:
```ts
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
```

- [x] **Step 5: Run it to verify it fails**

Run: `npx vitest run test/integration/health.test.ts`
Expected: FAIL — cannot resolve `../../src/app.js`.

- [x] **Step 6: Write `src/config.ts`**

```ts
export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 180 * 24 * 60 * 60;
export const EVENT_TIMEOUT_MS = 10_000;
export const EVENT_IN_FLIGHT_CAP = 200;
export const LOG_LEVEL = 'info';
export const PORT = 3000;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const QS_OPTIONS = { depth: 20, parameterLimit: 10_000, arrayLimit: 1000 } as const;

export type Config = {
  baseUrl: string;
  databaseUrl: string;
  portalAllowlist: string[];
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = required(env, 'BASE_URL').replace(/\/+$/, '');
  new URL(baseUrl); // throws on an invalid URL at boot
  return {
    baseUrl,
    databaseUrl: required(env, 'DATABASE_URL'),
    portalAllowlist: required(env, 'PORTAL_ALLOWLIST')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  };
}
```

Note: tasks.md 1.2 lists event timeout and in-flight cap as config; the Design Doc (§3) makes them constants. The Design Doc wins.

- [x] **Step 7: Write `src/app.ts` and `src/server.ts`**

`src/app.ts`:
```ts
import type { Writable } from 'node:stream';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import qs from 'qs';
import { BODY_LIMIT_BYTES, LOG_LEVEL, QS_OPTIONS, type Config } from './config.js';

export type AppDeps = { config: Config; logStream?: Writable };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: deps.logStream
      ? { level: LOG_LEVEL, stream: deps.logStream }
      : { level: LOG_LEVEL },
  });
  await app.register(formbody, { parser: (body) => qs.parse(body, QS_OPTIONS) });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
```

`src/server.ts`:
```ts
import { buildApp } from './app.js';
import { loadConfig, PORT } from './config.js';

const config = loadConfig();
const app = await buildApp({ config });
await app.listen({ host: '0.0.0.0', port: PORT });
```

- [x] **Step 8: Run the test, typecheck and lint**

Run: `npx vitest run test/integration/health.test.ts && npm run typecheck && npm run format && npm run lint`
Expected: test PASS, no type or lint errors.

- [x] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json eslint.config.js .prettierrc.json .prettierignore .gitignore vitest.config.ts README.md src test
git commit -m "chore: add Fastify TypeScript service skeleton with health endpoint"
```

---

### Task 2: Protocol capture procedure and fixture sanitization (manual capture by the user)

- [ ] Task 2 complete: Protocol capture procedure and fixture sanitization (manual capture by the user)

tasks.md: **1.1**

The agent writes the procedure and the sanitize script; **the user** performs the capture on a test portal with internet access and runs the sanitizer. No other task waits for this except Task 14.

**Files:**
- Create: `docs/protocol-capture.md`
- Create: `scripts/sanitize-har.ts`
- Create (by the user, after capture): `test/fixtures/cloud-capture.har`, `test/fixtures/event-handler.har`

**Interfaces:**
- Produces: two sanitized HAR 1.2 files consumed by Task 14. `cloud-capture.har` holds portal/app ↔ cloud entries; `event-handler.har` holds the cloud → handler event POST. Secret values are `"<redacted>"`; the portal host is `portal.example`.

- [x] **Step 1: Write `scripts/sanitize-har.ts`**

```ts
// Usage: npx tsx scripts/sanitize-har.ts <input.raw.har> <output.har> <portal-host>
import { readFileSync, writeFileSync } from 'node:fs';
import qs from 'qs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Header = { name: string; value: string };
type HarEntry = {
  request: {
    url: string;
    headers: Header[];
    cookies: unknown[];
    queryString: unknown[];
    postData?: { mimeType: string; text?: string; params?: unknown[] };
  };
  response: {
    headers: Header[];
    cookies: unknown[];
    content: { mimeType: string; text?: string; encoding?: string };
  };
};
type Har = { log: { entries: HarEntry[] } };

const [input, output, portalHost] = process.argv.slice(2);
if (!input || !output || !portalHost) {
  throw new Error('Usage: sanitize-har.ts <input.raw.har> <output.har> <portal-host>');
}
const SECRET_KEY = /token|secret|client_id|member_id|^bx_|hash|licen|password|^code$/i;
const KEPT_HEADERS = new Set(['content-type']);

function scrub(value: Json, key = ''): Json {
  if (Array.isArray(value)) return value.map((item) => scrub(item, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  if (typeof value === 'string') {
    return SECRET_KEY.test(key) ? '<redacted>' : value.replaceAll(portalHost, 'portal.example');
  }
  return value;
}

function scrubText(text: string | undefined, mimeType: string): string | undefined {
  if (!text) return text;
  if (mimeType.includes('json')) return JSON.stringify(scrub(JSON.parse(text) as Json));
  if (mimeType.includes('x-www-form-urlencoded')) {
    return qs.stringify(scrub(qs.parse(text, { depth: 20, arrayLimit: 1000 }) as Json));
  }
  return '<redacted body>';
}

function scrubUrl(raw: string): string {
  const url = new URL(raw.replaceAll(portalHost, 'portal.example'));
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_KEY.test(key)) url.searchParams.set(key, '<redacted>');
  }
  return url.toString();
}

const har = JSON.parse(readFileSync(input, 'utf8')) as Har;
for (const entry of har.log.entries) {
  const { request, response } = entry;
  request.url = scrubUrl(request.url);
  request.headers = request.headers.filter((h) => KEPT_HEADERS.has(h.name.toLowerCase()));
  request.cookies = [];
  request.queryString = [];
  if (request.postData) {
    request.postData.text = scrubText(request.postData.text, request.postData.mimeType);
    request.postData.params = [];
  }
  response.headers = response.headers.filter((h) => KEPT_HEADERS.has(h.name.toLowerCase()));
  response.cookies = [];
  if (response.content.encoding === 'base64' && response.content.text) {
    response.content.text = Buffer.from(response.content.text, 'base64').toString('utf8');
    delete response.content.encoding;
  }
  response.content.text = scrubText(response.content.text, response.content.mimeType);
}
writeFileSync(output, JSON.stringify(har, null, 2));
```

- [x] **Step 2: Write `docs/protocol-capture.md`**

```markdown
# Protocol capture against the cloud OAuth server

Purpose: record real request/response pairs between a test on-premise portal and the cloud
OAuth server, so contract tests (task 7.1) compare our shapes with the cloud's. Performed
manually by a developer on a test portal **with** internet access. Never on a customer portal.

## Prerequisites

- Test on-premise Bitrix24 portal (rest module 26.x) you may reconfigure.
- A host reachable by the portal with mitmproxy ≥ 10.1 (`mitmdump`, HAR export via `hardump`).
- A second host reachable **from the internet** for the event handler (a temporary VM you
  control; do not use third-party webhook catchers: event bodies carry tokens).
- Node.js and this repository (`npm install`) to run the sanitizer.

## 1. Cloud proxy

On the proxy host (pick the cloud server for the portal's region):

    mitmdump --mode reverse:https://oauth.bitrix24.tech -p 8080 --set hardump=./cloud-capture.raw.har

Point the portal at the proxy (admin "PHP command line"):

    \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'http://<proxy-host>:8080');
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

Deleting the service credentials forces `/oauth/register/` on the next call.

## 2. Event handler capture

On the internet-facing VM run a tiny handler behind mitmdump:

    python3 -m http.server 9000 &
    mitmdump --mode reverse:http://127.0.0.1:9000 -p 8081 --set hardump=./event-handler.raw.har

(`http.server` answers POST with 501; that is fine, only the request body matters.)

## 3. Actions on the portal (in this order)

1. Open Developer resources → Other → Local application. Create a **server-side** local app
   with handler `http://<vm>:8081/handler`, scope `crm,user`, and an **app with UI** with any
   handler URL. → `/oauth/register/`, `application.add`.
2. Install the server-side app. → `rest.event.call` with `ONAPPINSTALL`, then the cloud POSTs
   to the handler.
3. Open the UI app page as an admin. → `rest.authorize`.
4. From the browser console of the app frame copy `access_token`, `refresh_token`; call
   `https://<portal>/rest/profile?auth=<access_token>`. → `rest.check` (valid).
5. Call `https://<portal>/rest/profile?auth=garbage`. → `rest.check` (invalid token error).
6. Renew through the proxy **twice with the same refresh token**:

       curl "http://<proxy-host>:8080/oauth/token/?grant_type=refresh_token&client_id=<app client_id>&client_secret=<app secret>&refresh_token=<refresh_token>"

   Run the identical command again. Record whether the second call returned a new pair (reuse
   allowed) or an error.
7. Once more with `refresh_token=garbage` (invalid grant error) and with
   `grant_type=authorization_code` (unsupported grant error).
8. Delete the UI app. → `application.delete`.

Stop both mitmdump processes (Ctrl+C writes the HAR files).

## 4. Restore the portal

    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'oauth_server']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

## 5. Sanitize and commit

    npx tsx scripts/sanitize-har.ts cloud-capture.raw.har test/fixtures/cloud-capture.har <portal-host>
    npx tsx scripts/sanitize-har.ts event-handler.raw.har test/fixtures/event-handler.har <portal-host>
    grep -c "<portal-host>" test/fixtures/*.har      # expect 0 for both files
    grep -c "<access_token value from step 4>" test/fixtures/*.har   # expect 0

Delete the `*.raw.har` files afterwards (they are git-ignored but contain live secrets).

## 6. Results (fill in after the capture)

| Question | Observed |
|---|---|
| Second refresh with the same refresh token | _new pair / error code_ |
| HTTP status of `invalid_client`, `invalid_grant`, `unsupported_grant_type` | |
| HTTP status of `rest.check` errors, `ERROR_OAUTH` | |
| Exact RPC path form (`/rest/rest.check` or with `.json`) | |
| Fields in `rest.authorize` result not in our response | |

If reuse is **rejected** by the cloud, stop and reopen the token-service spec in Comet
(Design Doc §10 risk) before release.
```

- [x] **Step 3: Typecheck and lint the script**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [x] **Step 4: Commit the procedure and script**

```bash
git add docs/protocol-capture.md scripts/sanitize-har.ts
git commit -m "docs: add cloud protocol capture procedure and HAR sanitizer"
```

- [ ] **Step 5 (user, any time later): Capture, sanitize, fill the results table, commit fixtures**

```bash
git add test/fixtures/cloud-capture.har test/fixtures/event-handler.har docs/protocol-capture.md
git commit -m "test: add sanitized cloud protocol capture fixtures"
```

---

### Task 3: Storage schema, migrations and portal registration

- [x] Task 3 complete: Storage schema, migrations and portal registration

tasks.md: **2.1**, **3.1**, part of **1.3** (database service) and **1.4** (DB test setup)

**Files:**
- Create: `src/schema.ts`, `src/db.ts`, `drizzle.config.ts`, `drizzle/0000_init.sql` (generated), `src/bitrix.ts`, `src/tokens.ts`, `src/routes/register.ts`, `docker-compose.yml`
- Create: `test/global-setup.ts`, `test/helpers.ts`, `test/integration/portal-registration.test.ts`
- Modify: `src/app.ts`, `src/server.ts`, `vitest.config.ts`, `test/integration/health.test.ts`

**Interfaces:**
- Consumes: `Config`, constants from Task 1.
- Produces:
  - `schema.ts`: tables `portals`, `applications`, `tokenPairs`; types `Portal`, `Application`, `TokenPair` (`$inferSelect`).
  - `db.ts`: `type Db = NodePgDatabase<typeof schema>`; `createDb(url: string): { db: Db; pool: pg.Pool }`.
  - `bitrix.ts`: `class BitrixError(code: string, description: string, status = 400)`; `fail(code, description, status?): never`; `ok<T>(result: T): { result: T }`; `sendError(error: FastifyError, request, reply)`.
  - `tokens.ts`: `sha256(value: string): string`; `randomHex(bytes: number): string`; `hashMatches(hashHex: string, plain: string): boolean`.
  - `app.ts`: `type AppDeps = { config: Config; db: Db; logStream?: Writable }`.
  - `routes/register.ts`: `registerRoute(app: FastifyInstance, deps: AppDeps): void`.
  - `test/helpers.ts`: `TEST_DATABASE_URL`, `PORTAL = 'https://portal.test'`, `OTHER_PORTAL = 'https://other.test'`, `TEST_CONFIG`, `type LogLine`, `type TestApp = { app; db; logs: LogLine[]; close(): Promise<void> }`, `startApp(): Promise<TestApp>`, `truncateAll(db: Db): Promise<void>`, `form(body)`, `type Credentials = { client_id: string; client_secret: string }`, `registerPortal(app, redirectUri?): Promise<Credentials>`.

- [x] **Step 1: Add the database service and start it**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: b24auth
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-b24auth}
      POSTGRES_DB: b24auth
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - '127.0.0.1:5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U b24auth']
      interval: 5s
      retries: 10

volumes:
  pgdata: {}
```

Run: `docker compose up -d db`
Expected: container `db` healthy (`docker compose ps`).

- [x] **Step 2: Write `src/schema.ts`, `src/db.ts`, `drizzle.config.ts` and generate the migration**

`src/schema.ts`:
```ts
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const portals = pgTable('portals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  origin: text('origin').notNull().unique(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  portalId: bigint('portal_id', { mode: 'number' })
    .notNull()
    .references(() => portals.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  title: text('title').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tokenPairs = pgTable(
  'token_pairs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    applicationId: bigint('application_id', { mode: 'number' })
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    accessHash: text('access_hash').notNull().unique(),
    refreshHash: text('refresh_hash').notNull().unique(),
    userId: integer('user_id').notNull(),
    scope: text('scope').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('token_pairs_refresh_expires_at_idx').on(table.refreshExpiresAt)],
);

export type Portal = typeof portals.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type TokenPair = typeof tokenPairs.$inferSelect;
```

`src/db.ts`:
```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}
```

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
```

Run: `npx drizzle-kit generate --name init`
Expected: `drizzle/0000_init.sql` with three `CREATE TABLE`, two `ON DELETE cascade` foreign keys, unique constraints and `token_pairs_refresh_expires_at_idx`; plus `drizzle/meta/`.

- [x] **Step 3: Write test infrastructure**

`test/global-setup.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { TEST_DATABASE_URL } from './helpers.js';

export async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
}
```

`test/helpers.ts`:
```ts
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import qs from 'qs';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';

// Tests TRUNCATE this database; never point it at real data.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://b24auth:b24auth@localhost:5432/b24auth_test';
export const PORTAL = 'https://portal.test';
export const OTHER_PORTAL = 'https://other.test';
export const TEST_CONFIG: Config = {
  baseUrl: 'https://auth.test',
  databaseUrl: TEST_DATABASE_URL,
  portalAllowlist: ['portal.test', 'other.test'],
};

export type LogLine = { level: number; msg: string; [key: string]: unknown };
export type TestApp = {
  app: FastifyInstance;
  db: Db;
  logs: LogLine[];
  close: () => Promise<void>;
};

export async function startApp(): Promise<TestApp> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const logs: LogLine[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line) logs.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  });
  const app = await buildApp({ config: TEST_CONFIG, db, logStream });
  return {
    app,
    db,
    logs,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE portals, applications, token_pairs RESTART IDENTITY CASCADE`);
}

export function form(body: Record<string, unknown>): {
  headers: Record<string, string>;
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: qs.stringify(body),
  };
}

export type Credentials = { client_id: string; client_secret: string };

export async function registerPortal(
  app: FastifyInstance,
  redirectUri = `${PORTAL}/`,
): Promise<Credentials> {
  const res = await app.inject({
    method: 'POST',
    url: '/oauth/register/',
    ...form({ redirect_uri: redirectUri, type: 'B' }),
  });
  return res.json<Credentials>();
}
```

`vitest.config.ts` — add `globalSetup`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    globalSetup: ['test/global-setup.ts'],
  },
});
```

- [x] **Step 4: Write the failing registration tests**

`test/integration/portal-registration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { portals } from '../../src/schema.js';
import { form, PORTAL, startApp, truncateAll, type TestApp } from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
});

describe('portal-registration', () => {
  it('Allowed portal registers', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: `${PORTAL}/`, type: 'B', member_id: 'abc', BX_TYPE: 'x' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ client_id: string; client_secret: string }>();
    expect(body.client_id).toMatch(/^[0-9a-f]{32}$/);
    expect(body.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const rows = await t.db.select().from(portals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: PORTAL, clientId: body.client_id });
    expect(rows[0].secretHash).not.toBe(body.client_secret);
  });

  it('Unknown portal is rejected', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: 'https://evil.test/', type: 'B' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'access_denied', error_description: expect.any(String) });
    expect(await t.db.select().from(portals)).toHaveLength(0);
  });
});
```

- [x] **Step 5: Run to verify they fail**

Run: `npx vitest run test/integration/portal-registration.test.ts`
Expected: FAIL — `buildApp` does not accept `db` / route `/oauth/register/` returns 404.

- [x] **Step 6: Write `src/bitrix.ts`, `src/tokens.ts`, `src/routes/register.ts`**

`src/bitrix.ts`:
```ts
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class BitrixError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(`${code}: ${description}`);
  }
}

export function fail(code: string, description: string, status = 400): never {
  throw new BitrixError(code, description, status);
}

export function ok<T>(result: T): { result: T } {
  return { result };
}

export function sendError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof BitrixError) {
    return reply
      .status(error.status)
      .send({ error: error.code, error_description: error.description });
  }
  if (error.validation || (error.statusCode !== undefined && error.statusCode < 500)) {
    return reply
      .status(error.statusCode ?? 400)
      .send({ error: 'invalid_request', error_description: error.message });
  }
  request.log.error({ err: error }, 'unhandled_error');
  return reply.status(500).send({ error: 'internal_error' });
}
```

`src/tokens.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function hashMatches(hashHex: string, plain: string): boolean {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = Buffer.from(sha256(plain), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

`src/routes/register.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail } from '../bitrix.js';
import { portals } from '../schema.js';
import { randomHex, sha256 } from '../tokens.js';

type RegisterBody = { redirect_uri: string };

const registerSchema = {
  type: 'object',
  required: ['redirect_uri'],
  properties: { redirect_uri: { type: 'string' } },
} as const;

export function registerRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Body: RegisterBody }>(
    '/oauth/register/',
    { schema: { body: registerSchema } },
    async (request) => {
      let url: URL;
      try {
        url = new URL(request.body.redirect_uri);
      } catch {
        fail('invalid_request', 'redirect_uri is not a valid URL');
      }
      if (!deps.config.portalAllowlist.includes(url.host.toLowerCase())) {
        fail('access_denied', 'Portal is not allowed to register on this server');
      }
      const origin = url.origin.toLowerCase();
      const clientId = randomHex(16);
      const clientSecret = randomHex(32);
      const secretHash = sha256(clientSecret);
      // Licence fields (BX_*) are ignored in this stage.
      await deps.db
        .insert(portals)
        .values({ origin, clientId, secretHash })
        .onConflictDoUpdate({ target: portals.origin, set: { clientId, secretHash } });
      return { client_id: clientId, client_secret: clientSecret };
    },
  );
}
```

- [x] **Step 7: Wire `db`, the error handler and the route into `src/app.ts`; migrate in `src/server.ts`**

`src/app.ts`:
```ts
import type { Writable } from 'node:stream';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import qs from 'qs';
import { sendError } from './bitrix.js';
import { BODY_LIMIT_BYTES, LOG_LEVEL, QS_OPTIONS, type Config } from './config.js';
import type { Db } from './db.js';
import { registerRoute } from './routes/register.js';

export type AppDeps = { config: Config; db: Db; logStream?: Writable };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: deps.logStream
      ? { level: LOG_LEVEL, stream: deps.logStream }
      : { level: LOG_LEVEL },
  });
  await app.register(formbody, { parser: (body) => qs.parse(body, QS_OPTIONS) });
  app.setErrorHandler(sendError);
  app.get('/health', async () => ({ status: 'ok' }));
  registerRoute(app, deps);
  return app;
}
```

`src/server.ts`:
```ts
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
```

`test/integration/health.test.ts` — now needs a db:
```ts
import { expect, it } from 'vitest';
import { startApp } from '../helpers.js';

it('GET /health returns ok', async () => {
  const t = await startApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await t.close();
});
```

- [x] **Step 8: Run all tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: 3 tests PASS; no errors.

- [x] **Step 9: Commit**

```bash
git add docker-compose.yml drizzle drizzle.config.ts src test vitest.config.ts
git commit -m "feat: add storage schema and portal registration with allowlist"
```

---

### Task 4: Portal RPC authentication, method dispatch and `application.list`

- [x] Task 4 complete: Portal RPC authentication, method dispatch and `application.list`

tasks.md: **3.2**, **4.3**, and the re-registration scenario of **3.1**

**Files:**
- Modify: `src/bitrix.ts` (method types), `src/app.ts` (register `rpcRoute`)
- Create: `src/routes/rpc.ts`, `src/methods/applications.ts`
- Modify: `test/helpers.ts` (add `rpc`)
- Modify: `test/integration/portal-registration.test.ts`
- Create: `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `hashMatches`, `fail`, `ok`, `portals`, `Portal`, `AppDeps`.
- Produces:
  - `bitrix.ts`: `type DeliveryState = { inFlight: number }`; `type MethodContext = { portal: Portal; db: Db; config: Config; log: FastifyBaseLogger; delivery: DeliveryState }`; `type Method = { schema: object; handler: (ctx: MethodContext, body: unknown) => Promise<unknown> }`; `defineMethod<B>(schema: object, handler: (ctx: MethodContext, body: B) => Promise<unknown>): Method`.
  - `routes/rpc.ts`: `rpcRoute(app: FastifyInstance, deps: AppDeps): void`; the `methods` object (extended by later tasks).
  - `methods/applications.ts`: `applicationList: Method`.
  - `test/helpers.ts`: `type RpcResponse<T> = { status: number; body: { result?: T; error?: string; error_description?: string } }`; `rpc<T = unknown>(app, creds: Credentials, method: string, body?: Record<string, unknown>): Promise<RpcResponse<T>>`.

- [x] **Step 1: Add the `rpc` helper to `test/helpers.ts`** (append)

```ts
export type RpcResponse<T> = {
  status: number;
  body: { result?: T; error?: string; error_description?: string };
};

export async function rpc<T = unknown>(
  app: FastifyInstance,
  creds: Credentials,
  method: string,
  body: Record<string, unknown> = {},
): Promise<RpcResponse<T>> {
  const res = await app.inject({
    method: 'POST',
    url: `/rest/${method}`,
    ...form({ ...creds, ...body }),
  });
  return { status: res.statusCode, body: res.json<RpcResponse<T>['body']>() };
}
```

- [x] **Step 2: Write the failing tests**

Append to `test/integration/portal-registration.test.ts` (update imports: add `applications` from `../../src/schema.js` and `registerPortal`, `rpc` from `../helpers.js`), inside `describe('portal-registration')`:
```ts
  it('Portal re-registers', async () => {
    const first = await registerPortal(t.app);
    const [before] = await t.db.select().from(portals);
    await t.db.insert(applications).values({
      portalId: before.id,
      clientId: 'local.00000000000000.00000001',
      secretHash: 'kept',
      title: 'Kept app',
      redirectUri: '',
      scope: 'crm',
    });

    const second = await registerPortal(t.app);

    expect(second.client_id).not.toBe(first.client_id);
    const after = await t.db.select().from(portals);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect((await rpc(t.app, first, 'application.list')).body.error).toBe('invalid_client');
    expect((await rpc(t.app, second, 'application.list')).body).toEqual({ result: [] });
    expect(await t.db.select().from(applications)).toHaveLength(1);
  });

  it('Valid service credentials', async () => {
    const creds = await registerPortal(t.app);
    const res = await rpc(t.app, creds, 'application.list', {
      client_redirect_uri: `${PORTAL}/`,
      member_id: 'ignored',
      bx24_request_id: 'ignored',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: [] });
  });

  it('Invalid service credentials', async () => {
    const creds = await registerPortal(t.app);
    const unknown = await rpc(t.app, { client_id: 'nope', client_secret: 'nope' }, 'application.list');
    const wrongSecret = await rpc(t.app, { ...creds, client_secret: 'wrong' }, 'application.list');
    for (const res of [unknown, wrongSecret]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      expect(res.body.result).toBeUndefined();
    }
  });

  it('Unknown method', async () => {
    const creds = await registerPortal(t.app);
    const res = await rpc(t.app, creds, 'application.install');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ERROR_METHOD_NOT_FOUND');
  });
```

`test/integration/application-registry.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPortal, rpc, startApp, truncateAll, type TestApp } from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
});

describe('application-registry', () => {
  it('Status sync', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.list');
    expect(res.body).toEqual({ result: [] });
  });
});
```

- [x] **Step 3: Run to verify they fail**

Run: `npx vitest run test/integration/portal-registration.test.ts test/integration/application-registry.test.ts`
Expected: the 5 new tests FAIL (404 / no `error` field); the 2 Task 3 tests still PASS.

- [x] **Step 4: Add method types to `src/bitrix.ts`** (append; add imports `FastifyBaseLogger` from `fastify`, `type Config` from `./config.js`, `type Db` from `./db.js`, `type Portal` from `./schema.js`)

```ts
export type DeliveryState = { inFlight: number };

export type MethodContext = {
  portal: Portal;
  db: Db;
  config: Config;
  log: FastifyBaseLogger;
  delivery: DeliveryState;
};

export type Method = {
  schema: object;
  handler: (ctx: MethodContext, body: unknown) => Promise<unknown>;
};

// The body is validated against `schema` by Fastify before the handler runs.
export function defineMethod<B>(
  schema: object,
  handler: (ctx: MethodContext, body: B) => Promise<unknown>,
): Method {
  return { schema, handler: (ctx, body) => handler(ctx, body as B) };
}
```

- [x] **Step 5: Write `src/methods/applications.ts` and `src/routes/rpc.ts`**

`src/methods/applications.ts`:
```ts
import { defineMethod } from '../bitrix.js';

export const applicationList = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () => [],
);
```

`src/routes/rpc.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail, ok, type DeliveryState, type Method } from '../bitrix.js';
import { applicationList } from '../methods/applications.js';
import { portals, type Portal } from '../schema.js';
import { hashMatches } from '../tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    portal: Portal | null;
  }
}

const methods: Record<string, Method> = {
  'application.list': applicationList,
};

export function rpcRoute(app: FastifyInstance, deps: AppDeps): void {
  const delivery: DeliveryState = { inFlight: 0 };
  app.decorateRequest('portal', null);

  // preValidation: credentials are checked before the body schema, so a bad caller
  // always gets invalid_client and nothing else runs.
  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const clientId = typeof body.client_id === 'string' ? body.client_id : '';
    const secret = typeof body.client_secret === 'string' ? body.client_secret : '';
    const [portal] = await deps.db
      .select()
      .from(portals)
      .where(eq(portals.clientId, clientId))
      .limit(1);
    if (!portal || !hashMatches(portal.secretHash, secret)) {
      fail('invalid_client', 'Invalid client credentials', 401);
    }
    request.portal = portal;
  };

  for (const [name, method] of Object.entries(methods)) {
    app.post(
      `/rest/${name}`,
      { preValidation: authenticate, schema: { body: method.schema } },
      async (request) => {
        const portal = request.portal;
        if (!portal) fail('invalid_client', 'Invalid client credentials', 401);
        const ctx = { portal, db: deps.db, config: deps.config, log: request.log, delivery };
        return ok(await method.handler(ctx, request.body));
      },
    );
  }

  app.post('/rest/:method', { preValidation: authenticate }, async () =>
    fail('ERROR_METHOD_NOT_FOUND', 'Method not found'),
  );
}
```

`src/app.ts` — add `import { rpcRoute } from './routes/rpc.js';` and after `registerRoute(app, deps);`:
```ts
  rpcRoute(app, deps);
```

- [x] **Step 6: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [x] **Step 7: Commit**

```bash
git add src test
git commit -m "feat: authenticate portal RPC calls and dispatch methods"
```

---

### Task 5: `application.add`

- [x] Task 5 complete: `application.add`

tasks.md: **4.1**

**Files:**
- Modify: `src/tokens.ts` (add `normalizeScope`), `src/methods/applications.ts`, `src/routes/rpc.ts`
- Modify: `test/helpers.ts` (add `APP_FIELDS`, `addApp`), `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `defineMethod`, `randomHex`, `sha256`, `applications`.
- Produces: `normalizeScope(value: string | string[] | undefined): string`; `scopeSchema` (exported from `methods/applications.ts`); `applicationAdd: Method`; helpers `APP_FIELDS = { TITLE: 'Demo app', REDIRECT_URI: 'https://app.test/handler', SCOPE: 'crm,user' }`, `addApp(app, portal: Credentials, fields?): Promise<Credentials>`.

- [x] **Step 1: Add helpers to `test/helpers.ts`** (append)

```ts
export const APP_FIELDS = {
  TITLE: 'Demo app',
  REDIRECT_URI: 'https://app.test/handler',
  SCOPE: 'crm,user',
};

export async function addApp(
  app: FastifyInstance,
  portal: Credentials,
  fields: Record<string, unknown> = APP_FIELDS,
): Promise<Credentials> {
  const res = await rpc<Credentials>(app, portal, 'application.add', fields);
  if (!res.body.result) throw new Error(`application.add failed: ${JSON.stringify(res.body)}`);
  return res.body.result;
}
```

- [x] **Step 2: Write the failing test** (in `application-registry.test.ts`; import `applications` from `../../src/schema.js` and `APP_FIELDS`, `type Credentials` from helpers)

```ts
  it('Portal creates a local app', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc<Credentials>(t.app, portal, 'application.add', APP_FIELDS);
    expect(res.status).toBe(200);
    const created = res.body.result;
    expect(created?.client_id).toMatch(/^local\.[0-9a-f]{14}\.\d{8}$/);
    expect(created?.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: created?.client_id,
      title: 'Demo app',
      redirectUri: 'https://app.test/handler',
      scope: 'crm,user',
    });
    expect(rows[0].secretHash).not.toBe(created?.client_secret);
  });
```

- [x] **Step 3: Run to verify it fails**

Run: `npx vitest run test/integration/application-registry.test.ts -t "Portal creates a local app"`
Expected: FAIL — `ERROR_METHOD_NOT_FOUND`.

- [x] **Step 4: Implement**

`src/tokens.ts` — append:
```ts
function splitScope(scope: string): string[] {
  return scope
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// The portal may send SCOPE as "a,b" or as SCOPE[]=a&SCOPE[]=b; store "a,b".
export function normalizeScope(value: string | string[] | undefined): string {
  const joined = Array.isArray(value) ? value.join(',') : (value ?? '');
  return [...new Set(splitScope(joined))].join(',');
}
```

`src/methods/applications.ts`:
```ts
import { randomInt } from 'node:crypto';
import { defineMethod } from '../bitrix.js';
import { applications } from '../schema.js';
import { normalizeScope, randomHex, sha256 } from '../tokens.js';

export const scopeSchema = {
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
} as const;

type AddBody = { TITLE: string; REDIRECT_URI: string; SCOPE?: string | string[] };

const addSchema = {
  type: 'object',
  required: ['TITLE'],
  properties: {
    TITLE: { type: 'string' },
    REDIRECT_URI: { type: 'string', default: '' },
    SCOPE: scopeSchema,
  },
} as const;

function localClientId(): string {
  return `local.${randomHex(7)}.${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export const applicationAdd = defineMethod<AddBody>(addSchema, async (ctx, body) => {
  const clientId = localClientId();
  const clientSecret = randomHex(32);
  await ctx.db.insert(applications).values({
    portalId: ctx.portal.id,
    clientId,
    secretHash: sha256(clientSecret),
    title: body.TITLE,
    redirectUri: body.REDIRECT_URI,
    scope: normalizeScope(body.SCOPE),
  });
  return { client_id: clientId, client_secret: clientSecret };
});

export const applicationList = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () => [],
);
```

`src/routes/rpc.ts` — import `applicationAdd` and extend the map:
```ts
const methods: Record<string, Method> = {
  'application.add': applicationAdd,
  'application.list': applicationList,
};
```

- [x] **Step 5: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add src test
git commit -m "feat: add local applications with cloud client_id format"
```

---

### Task 6: Token pair issue, response builder, scope intersection and `rest.authorize`

- [ ] Task 6 complete: Token pair issue, response builder, scope intersection and `rest.authorize`

tasks.md: **5.1**, **5.2**

**Files:**
- Modify: `src/tokens.ts`
- Create: `src/methods/tokens.ts`
- Modify: `src/routes/rpc.ts`
- Modify: `test/helpers.ts` (add `authorize`, `md5`)
- Create: `test/unit/scope.test.ts`, `test/integration/token-service.test.ts`
- Modify: `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `Db`, `Config`, `Portal`, `Application`, `tokenPairs`, `ACCESS_TTL_SECONDS`, `REFRESH_TTL_SECONDS`, `scopeSchema`.
- Produces (`src/tokens.ts`):
  - `intersectScope(requested: string, appScope: string): string`
  - `memberId(portal: Portal): string` — `md5(portal.clientId)` hex
  - `portalDomain(portal: Portal): string` — host of `portal.origin`
  - `type TokenResponse = { access_token: string; refresh_token: string; expires: number; expires_in: number; scope: string; domain: string; server_endpoint: string; client_endpoint: string; member_id: string; user_id: number; status: 'L' }`
  - `type IssueInput = { scope: string; userId: number; params: Record<string, unknown> }`
  - `tokenResponse(config: Config, portal: Portal, pair: { accessToken: string; refreshToken: string; accessExpiresAt: Date; scope: string; userId: number }): TokenResponse`
  - `issuePair(db: Db, config: Config, app: Application, portal: Portal, input: IssueInput): Promise<TokenResponse>` (scope is already final)
- Produces (`src/methods/tokens.ts`): `restAuthorize: Method`.
- Produces (helpers): `md5(value: string): string`; `authorize(app, portal: Credentials, appClientId: string, extra?: Record<string, unknown>): Promise<TokenResponse>` — default body `{ CLIENT_ID, SCOPE: 'crm,user', PARAMS: { LOCAL_USER: '5', TZ_OFFSET: '10800' } }`.

- [ ] **Step 1: Write the failing unit test**

`test/unit/scope.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { intersectScope } from '../../src/tokens.js';

describe('intersectScope', () => {
  it.each([
    ['empty request takes the app scope', '', 'crm,user', 'crm,user'],
    ['subset', 'crm', 'crm,user', 'crm'],
    ['superset is cut to the app scope', 'crm,user,disk', 'crm,user', 'crm,user'],
    ['spaces are trimmed', ' crm , user ', 'crm, user', 'crm,user'],
    ['disjoint gives an empty scope', 'disk', 'crm', ''],
  ])('%s', (_name, requested, appScope, expected) => {
    expect(intersectScope(requested, appScope)).toBe(expected);
  });
});
```

Run: `npx vitest run test/unit/scope.test.ts`
Expected: FAIL — `intersectScope` is not exported.

- [ ] **Step 2: Add helpers to `test/helpers.ts`** (append; add `import { createHash } from 'node:crypto';` and `import type { TokenResponse } from '../src/tokens.js';` at the top)

```ts
export function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

export async function authorize(
  app: FastifyInstance,
  portal: Credentials,
  appClientId: string,
  extra: Record<string, unknown> = {},
): Promise<TokenResponse> {
  const res = await rpc<TokenResponse>(app, portal, 'rest.authorize', {
    CLIENT_ID: appClientId,
    SCOPE: 'crm,user',
    PARAMS: { LOCAL_USER: '5', TZ_OFFSET: '10800' },
    ...extra,
  });
  if (!res.body.result) throw new Error(`rest.authorize failed: ${JSON.stringify(res.body)}`);
  return res.body.result;
}
```

- [ ] **Step 3: Write the failing integration tests**

`test/integration/token-service.test.ts`:
```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tokenPairs } from '../../src/schema.js';
import {
  addApp,
  authorize,
  md5,
  OTHER_PORTAL,
  registerPortal,
  rpc,
  startApp,
  truncateAll,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
});

describe('token-service', () => {
  it('Fields present', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const before = Math.floor(Date.now() / 1000);

    const token = await authorize(t.app, portal, app.client_id);

    expect(Object.keys(token).sort()).toEqual(
      [
        'access_token',
        'client_endpoint',
        'domain',
        'expires',
        'expires_in',
        'member_id',
        'refresh_token',
        'scope',
        'server_endpoint',
        'status',
        'user_id',
      ].sort(),
    );
    expect(token).toMatchObject({
      expires_in: 3600,
      scope: 'crm,user',
      domain: 'portal.test',
      server_endpoint: 'https://auth.test/rest/',
      client_endpoint: 'https://portal.test/rest/',
      member_id: md5(portal.client_id),
      user_id: 5,
      status: 'L',
    });
    expect(token.access_token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.refresh_token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.expires).toBeGreaterThanOrEqual(before + 3600);
    expect(token.expires).toBeLessThanOrEqual(before + 3602);
    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.refreshExpiresAt.getTime() - pair.accessExpiresAt.getTime()).toBe(
      (180 * 24 * 3600 - 3600) * 1000,
    );
  });

  it('App page opens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const params = { LOCAL_USER: '5', TZ_OFFSET: '10800', EVENT_SESSION: { id: 'abc' } };

    const token = await authorize(t.app, portal, app.client_id, { PARAMS: params });

    expect(token.user_id).toBe(5);
    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.userId).toBe(5);
    expect(pair.params).toEqual(params);
  });

  it('Unknown application', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const foreignApp = await addApp(t.app, other);

    const res = await rpc(t.app, portal, 'rest.authorize', {
      CLIENT_ID: foreignApp.client_id,
      PARAMS: { LOCAL_USER: '1' },
    });

    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Application not installed',
    });
    expect(await t.db.select().from(tokenPairs)).toHaveLength(0);
  });

  it('Database leak', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    const dump = await t.db.execute(sql`SELECT * FROM token_pairs`);
    const text = JSON.stringify(dump.rows);

    expect(dump.rows).toHaveLength(1);
    expect(text).not.toContain(token.access_token);
    expect(text).not.toContain(token.refresh_token);
  });
});
```

Append to `application-registry.test.ts` (import `authorize`, `addApp`):
```ts
  it('Local app is usable immediately', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    expect(token.access_token).toMatch(/^[0-9a-f]{64}$/);
  });
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm test`
Expected: unit test and the 5 new integration tests FAIL (`ERROR_METHOD_NOT_FOUND` / missing export).

- [ ] **Step 5: Implement token issue in `src/tokens.ts`** (append; add imports at top: `import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, type Config } from './config.js';`, `import type { Db } from './db.js';`, `import { tokenPairs, type Application, type Portal } from './schema.js';`)

```ts
export function intersectScope(requested: string, appScope: string): string {
  const allowed = splitScope(appScope);
  const wanted = splitScope(requested);
  if (wanted.length === 0) return allowed.join(',');
  return wanted.filter((item) => allowed.includes(item)).join(',');
}

export function memberId(portal: Portal): string {
  return createHash('md5').update(portal.clientId).digest('hex');
}

export function portalDomain(portal: Portal): string {
  return new URL(portal.origin).host;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires: number;
  expires_in: number;
  scope: string;
  domain: string;
  server_endpoint: string;
  client_endpoint: string;
  member_id: string;
  user_id: number;
  status: 'L';
};

export type IssueInput = { scope: string; userId: number; params: Record<string, unknown> };

export function tokenResponse(
  config: Config,
  portal: Portal,
  pair: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    scope: string;
    userId: number;
  },
): TokenResponse {
  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    expires: Math.floor(pair.accessExpiresAt.getTime() / 1000),
    expires_in: ACCESS_TTL_SECONDS,
    scope: pair.scope,
    domain: portalDomain(portal),
    server_endpoint: `${config.baseUrl}/rest/`,
    client_endpoint: `${portal.origin}/rest/`,
    member_id: memberId(portal),
    user_id: pair.userId,
    status: 'L',
  };
}

export async function issuePair(
  db: Db,
  config: Config,
  app: Application,
  portal: Portal,
  input: IssueInput,
): Promise<TokenResponse> {
  const now = Date.now(); // expiry is computed in app code so fake timers apply in tests
  const accessToken = randomHex(32);
  const refreshToken = randomHex(32);
  const accessExpiresAt = new Date(now + ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000);
  await db.insert(tokenPairs).values({
    applicationId: app.id,
    accessHash: sha256(accessToken),
    refreshHash: sha256(refreshToken),
    userId: input.userId,
    scope: input.scope,
    params: input.params,
    accessExpiresAt,
    refreshExpiresAt,
  });
  return tokenResponse(config, portal, {
    accessToken,
    refreshToken,
    accessExpiresAt,
    scope: input.scope,
    userId: input.userId,
  });
}
```

- [ ] **Step 6: Write `src/methods/tokens.ts` and register it**

`src/methods/tokens.ts`:
```ts
import { and, eq } from 'drizzle-orm';
import { defineMethod, fail } from '../bitrix.js';
import { applications } from '../schema.js';
import { intersectScope, issuePair, normalizeScope } from '../tokens.js';
import { scopeSchema } from './applications.js';

type AuthorizeBody = {
  CLIENT_ID: string;
  SCOPE?: string | string[];
  PARAMS: Record<string, unknown>;
};

const authorizeSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: {
    CLIENT_ID: { type: 'string' },
    SCOPE: scopeSchema,
    PARAMS: { type: 'object', default: {} },
  },
} as const;

export const restAuthorize = defineMethod<AuthorizeBody>(authorizeSchema, async (ctx, body) => {
  const [app] = await ctx.db
    .select()
    .from(applications)
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .limit(1);
  if (!app) fail('ERROR_OAUTH', 'Application not installed');
  const userId = Number(body.PARAMS.LOCAL_USER ?? 0);
  return issuePair(ctx.db, ctx.config, app, ctx.portal, {
    scope: intersectScope(normalizeScope(body.SCOPE), app.scope),
    userId: Number.isInteger(userId) ? userId : 0,
    params: body.PARAMS,
  });
});
```

`src/routes/rpc.ts` — import `restAuthorize` from `../methods/tokens.js`; add `'rest.authorize': restAuthorize,` to `methods`.

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src test
git commit -m "feat: issue hashed token pairs via rest.authorize"
```

---

### Task 7: `rest.check`

- [ ] Task 7 complete: `rest.check`

tasks.md: **5.3**

**Files:**
- Modify: `src/tokens.ts` (add `check`), `src/methods/tokens.ts` (add `restCheck`), `src/routes/rpc.ts`
- Modify: `test/integration/token-service.test.ts`

**Interfaces:**
- Consumes: `sha256`, `memberId`, `tokenPairs`, `applications`, `fail`.
- Produces: `type CheckResult = { client_id: string; expires: number; scope: string; member_id: string; user_id: number; parameters: Record<string, unknown> }`; `check(db: Db, portal: Portal, token: string): Promise<CheckResult>` — throws `invalid_token` (401) or `expired_token` (401); `restCheck: Method`.

- [ ] **Step 1: Write the failing tests** (in `token-service.test.ts`; add `afterEach`, `vi` to the vitest import and register `afterEach(() => { vi.useRealTimers(); });` next to `beforeEach`)

```ts
  it('Valid token', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    const res = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });

    expect(res.body).toEqual({
      result: {
        client_id: app.client_id,
        expires: token.expires,
        scope: 'crm,user',
        member_id: token.member_id,
        user_id: 5,
        parameters: { LOCAL_USER: '5', TZ_OFFSET: '10800' },
      },
    });
  });

  it('Unknown or foreign token', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const otherApp = await addApp(t.app, other);
    const foreign = await authorize(t.app, other, otherApp.client_id);
    // Negative control: the token is valid on its own portal, so the denial below is
    // caused by portal scoping, not by a broken token.
    expect((await rpc(t.app, other, 'rest.check', { TOKEN: foreign.access_token })).body.result).toBeDefined();

    for (const tokenValue of ['0'.repeat(64), foreign.access_token]) {
      const res = await rpc(t.app, portal, 'rest.check', { TOKEN: tokenValue });
      expect(res.body.error).toBe('invalid_token');
      expect(res.body.result).toBeUndefined();
    }
  });

  it('Expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    vi.setSystemTime(Date.now() + 3600 * 1000);
    const res = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });

    expect(res.body.error).toBe('expired_token');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/token-service.test.ts`
Expected: the 3 new tests FAIL with `ERROR_METHOD_NOT_FOUND`.

- [ ] **Step 3: Implement**

`src/tokens.ts` — append (add `and`, `eq` from `drizzle-orm`, `applications` to the schema import, `fail` from `./bitrix.js`):
```ts
export type CheckResult = {
  client_id: string;
  expires: number;
  scope: string;
  member_id: string;
  user_id: number;
  parameters: Record<string, unknown>;
};

export async function check(db: Db, portal: Portal, token: string): Promise<CheckResult> {
  const [row] = await db
    .select({ pair: tokenPairs, clientId: applications.clientId })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .where(and(eq(tokenPairs.accessHash, sha256(token)), eq(applications.portalId, portal.id)))
    .limit(1);
  if (!row) fail('invalid_token', 'The access token provided is invalid', 401);
  if (row.pair.accessExpiresAt.getTime() <= Date.now()) {
    fail('expired_token', 'The access token provided has expired', 401);
  }
  return {
    client_id: row.clientId,
    expires: Math.floor(row.pair.accessExpiresAt.getTime() / 1000),
    scope: row.pair.scope,
    member_id: memberId(portal),
    user_id: row.pair.userId,
    parameters: row.pair.params,
  };
}
```

`src/methods/tokens.ts` — append (import `check` from `../tokens.js`):
```ts
type CheckBody = { TOKEN: string };

const checkSchema = {
  type: 'object',
  required: ['TOKEN'],
  properties: { TOKEN: { type: 'string' } },
} as const;

export const restCheck = defineMethod<CheckBody>(checkSchema, async (ctx, body) =>
  check(ctx.db, ctx.portal, body.TOKEN),
);
```

`src/routes/rpc.ts` — add `'rest.check': restCheck,`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: validate access tokens via rest.check"
```

---

### Task 8: `/oauth/token/` refresh grant

- [ ] Task 8 complete: `/oauth/token/` refresh grant

tasks.md: **5.4**

**Files:**
- Modify: `src/tokens.ts` (add `refresh`)
- Create: `src/routes/oauthToken.ts`
- Modify: `src/app.ts`
- Modify: `test/helpers.ts` (add `tokenRequest`), `test/integration/token-service.test.ts`

**Interfaces:**
- Consumes: `issuePair`, `hashMatches`, `sha256`, `fail`.
- Produces: `type RefreshInput = { clientId: string; clientSecret: string; refreshToken: string }`; `refresh(db: Db, config: Config, input: RefreshInput): Promise<TokenResponse>`; `oauthTokenRoute(app: FastifyInstance, deps: AppDeps): void`; helper `tokenRequest(app, method: 'GET' | 'POST', params: Record<string, string>): Promise<LightMyRequest Response>` (returns the `inject` response).

Order of checks (follows the spec scenarios; refines Design Doc §5.3, which checked the app first): find the pair by `sha256(refresh_token)` → none (including tokens cascaded away with a deleted app) → 400 `invalid_grant`; pair's application has a different `client_id` or the secret does not match → 401 `invalid_client`; refresh expired → 400 `invalid_grant`; else `issuePair` with the old pair's user, scope and params. The old pair is not touched.

- [ ] **Step 1: Add the helper** (append to `test/helpers.ts`)

```ts
export async function tokenRequest(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  params: Record<string, string>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  return method === 'GET'
    ? app.inject({ method: 'GET', url: `/oauth/token/?${qs.stringify(params)}` })
    : app.inject({ method: 'POST', url: '/oauth/token/', ...form(params) });
}
```

- [ ] **Step 2: Write the failing tests** (in `token-service.test.ts`; import `tokenRequest`, `type Credentials`, and `type TokenResponse` from `../../src/tokens.js`). Add a local setup function at file level:

```ts
async function issued(): Promise<{ portal: Credentials; app: Credentials; token: TokenResponse }> {
  const portal = await registerPortal(t.app);
  const app = await addApp(t.app, portal);
  const token = await authorize(t.app, portal, app.client_id);
  return { portal, app, token };
}

function refreshParams(app: Credentials, refreshToken: string): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    client_id: app.client_id,
    client_secret: app.client_secret,
    refresh_token: refreshToken,
  };
}
```

Tests inside `describe('token-service')`:
```ts
  it('Successful renewal', async () => {
    const { portal, app, token } = await issued();

    const res = await tokenRequest(t.app, 'POST', refreshParams(app, token.refresh_token));

    expect(res.statusCode).toBe(200);
    const renewed = res.json<TokenResponse>();
    expect(renewed).not.toHaveProperty('result');
    expect(renewed.access_token).not.toBe(token.access_token);
    expect(renewed.refresh_token).not.toBe(token.refresh_token);
    expect(renewed).toMatchObject({ user_id: 5, scope: 'crm,user', domain: 'portal.test' });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: renewed.access_token });
    expect(checked.body.result).toMatchObject({
      parameters: { LOCAL_USER: '5', TZ_OFFSET: '10800' },
    });
  });

  it('Refresh token reused', async () => {
    const { app, token } = await issued();

    const first = await tokenRequest(t.app, 'GET', refreshParams(app, token.refresh_token));
    const second = await tokenRequest(t.app, 'GET', refreshParams(app, token.refresh_token));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json<TokenResponse>();
    const b = second.json<TokenResponse>();
    expect(b.access_token).not.toBe(a.access_token);
    expect(b).toMatchObject({ user_id: a.user_id, scope: a.scope });
  });

  it('Refresh token expired or unknown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { app, token } = await issued();

    const unknown = await tokenRequest(t.app, 'POST', refreshParams(app, '0'.repeat(64)));
    vi.setSystemTime(Date.now() + 180 * 24 * 3600 * 1000);
    const expired = await tokenRequest(t.app, 'POST', refreshParams(app, token.refresh_token));

    for (const res of [unknown, expired]) {
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_grant');
    }
  });

  it('Wrong application secret', async () => {
    const { app, token } = await issued();

    const res = await tokenRequest(t.app, 'POST', {
      ...refreshParams(app, token.refresh_token),
      client_secret: 'wrong',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('Unsupported grant type', async () => {
    const res = await tokenRequest(t.app, 'POST', {
      grant_type: 'authorization_code',
      client_id: 'x',
      client_secret: 'y',
      code: 'z',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('unsupported_grant_type');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run test/integration/token-service.test.ts`
Expected: the 5 new tests FAIL (404 from Fastify).

- [ ] **Step 4: Implement `refresh` in `src/tokens.ts`** (append; add `portals` to the schema import)

```ts
export type RefreshInput = { clientId: string; clientSecret: string; refreshToken: string };

export async function refresh(db: Db, config: Config, input: RefreshInput): Promise<TokenResponse> {
  const [row] = await db
    .select({ pair: tokenPairs, app: applications, portal: portals })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .innerJoin(portals, eq(applications.portalId, portals.id))
    .where(eq(tokenPairs.refreshHash, sha256(input.refreshToken)))
    .limit(1);
  if (!row) fail('invalid_grant', 'Invalid refresh token');
  if (row.app.clientId !== input.clientId || !hashMatches(row.app.secretHash, input.clientSecret)) {
    fail('invalid_client', 'Invalid client credentials', 401);
  }
  if (row.pair.refreshExpiresAt.getTime() <= Date.now()) {
    fail('invalid_grant', 'Refresh token has expired');
  }
  // The old pair stays valid until its own expiry (reusable refresh tokens, spec D3).
  return issuePair(db, config, row.app, row.portal, {
    scope: row.pair.scope,
    userId: row.pair.userId,
    params: row.pair.params,
  });
}
```

- [ ] **Step 5: Write `src/routes/oauthToken.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail } from '../bitrix.js';
import { refresh, type TokenResponse } from '../tokens.js';

type TokenParams = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

const tokenParamsSchema = {
  type: 'object',
  properties: {
    grant_type: { type: 'string' },
    client_id: { type: 'string' },
    client_secret: { type: 'string' },
    refresh_token: { type: 'string' },
  },
} as const;

export function oauthTokenRoute(app: FastifyInstance, deps: AppDeps): void {
  const handle = async (params: TokenParams): Promise<TokenResponse> => {
    if (params.grant_type !== 'refresh_token') {
      fail('unsupported_grant_type', 'Only the refresh_token grant is supported');
    }
    if (!params.client_id || !params.client_secret || !params.refresh_token) {
      fail('invalid_request', 'client_id, client_secret and refresh_token are required');
    }
    return refresh(deps.db, deps.config, {
      clientId: params.client_id,
      clientSecret: params.client_secret,
      refreshToken: params.refresh_token,
    });
  };

  app.get<{ Querystring: TokenParams }>(
    '/oauth/token/',
    { schema: { querystring: tokenParamsSchema } },
    async (request) => handle(request.query),
  );
  app.post<{ Body: TokenParams }>(
    '/oauth/token/',
    { schema: { body: tokenParamsSchema } },
    async (request) => handle(request.body),
  );
}
```

`src/app.ts` — import `oauthTokenRoute` from `./routes/oauthToken.js`; add `oauthTokenRoute(app, deps);` after `rpcRoute(app, deps);`.

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src test
git commit -m "feat: renew tokens via /oauth/token/ with reusable refresh tokens"
```

---

### Task 9: `application.update` and `application.delete`

- [ ] Task 9 complete: `application.update` and `application.delete`

tasks.md: **4.2**

**Files:**
- Modify: `src/methods/applications.ts`, `src/routes/rpc.ts`
- Modify: `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `normalizeScope`, `scopeSchema`, `fail`, `applications`.
- Produces: `applicationUpdate: Method`, `applicationDelete: Method`; both return `true`; on a missing or foreign `CLIENT_ID` throw `ERROR_OAUTH` / `Application not found` (400).

- [ ] **Step 1: Write the failing tests** (in `application-registry.test.ts`; import `OTHER_PORTAL`, `tokenRequest`)

```ts
  it('Scope update applies to new tokens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);

    const updated = await rpc(t.app, portal, 'application.update', {
      CLIENT_ID: app.client_id,
      TITLE: 'Demo app',
      REDIRECT_URI: 'https://app.test/handler',
      SCOPE: 'crm',
    });
    const token = await authorize(t.app, portal, app.client_id, { SCOPE: 'crm,user' });

    expect(updated.body).toEqual({ result: true });
    expect(token.scope).toBe('crm');
  });

  it('Delete removes tokens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    // Negative control: the token works before the delete.
    expect((await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token })).body.result).toBeDefined();

    const deleted = await rpc(t.app, portal, 'application.delete', { CLIENT_ID: app.client_id });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    const renewed = await tokenRequest(t.app, 'POST', {
      grant_type: 'refresh_token',
      client_id: app.client_id,
      client_secret: app.client_secret,
      refresh_token: token.refresh_token,
    });

    expect(deleted.body).toEqual({ result: true });
    expect(checked.body.error).toBe('invalid_token');
    expect(renewed.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('Foreign application', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const foreignApp = await addApp(t.app, other);

    const updated = await rpc(t.app, portal, 'application.update', {
      CLIENT_ID: foreignApp.client_id,
      TITLE: 'Hijacked',
      SCOPE: 'disk',
    });
    const deleted = await rpc(t.app, portal, 'application.delete', {
      CLIENT_ID: foreignApp.client_id,
    });

    for (const res of [updated, deleted]) {
      expect(res.body).toEqual({ error: 'ERROR_OAUTH', error_description: 'Application not found' });
    }
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Demo app', scope: 'crm,user' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/application-registry.test.ts`
Expected: the 3 new tests FAIL with `ERROR_METHOD_NOT_FOUND`.

- [ ] **Step 3: Implement** (append to `src/methods/applications.ts`; add `import { and, eq } from 'drizzle-orm';` and `fail` to the bitrix import)

```ts
type UpdateBody = {
  CLIENT_ID: string;
  TITLE?: string;
  REDIRECT_URI?: string;
  SCOPE?: string | string[];
};

const updateSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: {
    CLIENT_ID: { type: 'string' },
    TITLE: { type: 'string' },
    REDIRECT_URI: { type: 'string' },
    SCOPE: scopeSchema,
  },
} as const;

type DeleteBody = { CLIENT_ID: string };

const deleteSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: { CLIENT_ID: { type: 'string' } },
} as const;

export const applicationUpdate = defineMethod<UpdateBody>(updateSchema, async (ctx, body) => {
  const updated = await ctx.db
    .update(applications)
    .set({
      // clientId is set to itself so the SET clause is never empty.
      clientId: body.CLIENT_ID,
      ...(body.TITLE !== undefined ? { title: body.TITLE } : {}),
      ...(body.REDIRECT_URI !== undefined ? { redirectUri: body.REDIRECT_URI } : {}),
      ...(body.SCOPE !== undefined ? { scope: normalizeScope(body.SCOPE) } : {}),
    })
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .returning({ id: applications.id });
  if (updated.length === 0) fail('ERROR_OAUTH', 'Application not found');
  return true;
});

export const applicationDelete = defineMethod<DeleteBody>(deleteSchema, async (ctx, body) => {
  // token_pairs rows go with the application (ON DELETE CASCADE).
  const deleted = await ctx.db
    .delete(applications)
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .returning({ id: applications.id });
  if (deleted.length === 0) fail('ERROR_OAUTH', 'Application not found');
  return true;
});
```

`src/routes/rpc.ts` — import both and add `'application.update': applicationUpdate,` and `'application.delete': applicationDelete,`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: update and delete local applications with ownership check"
```

---

### Task 10: `rest.event.call` intake, fire-and-forget delivery, failure logging

- [ ] Task 10 complete: `rest.event.call` intake, fire-and-forget delivery, failure logging

tasks.md: **6.1** (intake, timeout), **6.2** (no-user `auth` block), **6.3**

**Files:**
- Create: `src/methods/events.ts`
- Modify: `src/routes/rpc.ts`
- Modify: `test/helpers.ts` (add `startHandler`, `eventItem`)
- Create: `test/integration/event-delivery.test.ts`

**Interfaces:**
- Consumes: `defineMethod`, `MethodContext` (incl. `delivery`), `memberId`, `portalDomain`, `EVENT_TIMEOUT_MS`.
- Produces: `type EventItem = { client_id?: string; auth?: Record<string, unknown>; query: { QUERY_URL: string; QUERY_DATA?: Record<string, unknown> }; additional?: Record<string, unknown> }`; `deliver(ctx: MethodContext, item: EventItem): Promise<void>` (never rejects); `restEventCall: Method`. Log messages: `event_delivery_failed` with fields `portal`, `client_id`, `event`, `url`, and `status` or `error`.
- Produces (helpers): `type HandlerServer = { url: string; requests: Record<string, unknown>[]; release(): void; close(): Promise<void> }`; `startHandler(options?: { hold?: boolean }): Promise<HandlerServer>`; `eventItem(url: string, overrides?: { client_id?: string; event?: string; auth?: Record<string, unknown>; additional?: Record<string, unknown>; data?: unknown }): Record<string, unknown>`.

- [ ] **Step 1: Add helpers** (append to `test/helpers.ts`; add `import { createServer, type ServerResponse } from 'node:http';` and `import type { AddressInfo } from 'node:net';`)

```ts
export type HandlerServer = {
  url: string;
  requests: Record<string, unknown>[];
  release: () => void;
  close: () => Promise<void>;
};

// Local event handler. With hold: true it records each request but never answers
// until release() or close().
export async function startHandler(options: { hold?: boolean } = {}): Promise<HandlerServer> {
  const requests: Record<string, unknown>[] = [];
  const held: ServerResponse[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      requests.push(qs.parse(raw, { depth: 20, parameterLimit: 10_000, arrayLimit: 1000 }));
      if (options.hold) held.push(res);
      else res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const release = (): void => {
    for (const res of held.splice(0)) res.end('ok');
  };
  return {
    url: `http://127.0.0.1:${port}/handler`,
    requests,
    release,
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function eventItem(
  url: string,
  overrides: {
    client_id?: string;
    event?: string;
    auth?: Record<string, unknown>;
    additional?: Record<string, unknown>;
    data?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    client_id: overrides.client_id, // undefined is dropped by qs.stringify
    auth: overrides.auth ?? { LOCAL_USER: '0', application_token: 'apptoken123' },
    query: {
      QUERY_URL: url,
      QUERY_DATA: {
        event: overrides.event ?? 'ONCRMDEALADD',
        event_handler_id: '7',
        data: overrides.data ?? { FIELDS: { ID: '42' } },
        ts: '1763460000',
      },
    },
    additional: overrides.additional ?? { sendAuth: '0', sendRefreshToken: '0' },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`test/integration/event-delivery.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addApp,
  eventItem,
  md5,
  PORTAL,
  registerPortal,
  rpc,
  startApp,
  startHandler,
  truncateAll,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
  t.logs.length = 0;
});

describe('event-delivery', () => {
  it('Portal hands over events', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    try {
      const res = await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url, { event: 'ONE' }), eventItem(handler.url, { event: 'TWO' })],
      });

      // The handler holds both responses, so result: true proves we did not wait for delivery.
      expect(res.body).toEqual({ result: true });
      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      expect(handler.requests.map((r) => r.event).sort()).toEqual(['ONE', 'TWO']);
    } finally {
      await handler.close();
    }
  });

  it('Event without user auth', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            auth: { LOCAL_USER: '1', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
          eventItem(handler.url, {
            client_id: app.client_id,
            auth: { LOCAL_USER: '0', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      for (const request of handler.requests) {
        expect(request).toEqual({
          event: 'ONCRMDEALADD',
          event_handler_id: '7',
          data: { FIELDS: { ID: '42' } },
          ts: '1763460000',
          auth: {
            domain: 'portal.test',
            member_id: md5(portal.client_id),
            application_token: 'apptoken123',
          },
        });
      }
    } finally {
      await handler.close();
    }
  });

  it('Handler is down', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    const url = handler.url;
    await handler.close(); // connections to this port are now refused

    await rpc(t.app, portal, 'rest.event.call', {
      QUERY: [eventItem(url, { client_id: app.client_id })],
    });

    const failures = (): typeof t.logs => t.logs.filter((l) => l.msg === 'event_delivery_failed');
    await vi.waitFor(() => {
      expect(failures()).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      portal: PORTAL,
      client_id: app.client_id,
      event: 'ONCRMDEALADD',
      url,
    });
  });

  it('Nested data deeper than 5 levels arrives intact', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler();
    const deep = { a: { b: { c: { d: { e: { f: { g: 'leaf' } } } } } } };
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url, { data: deep })],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      expect(handler.requests[0].data).toEqual(deep);
    } finally {
      await handler.close();
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run test/integration/event-delivery.test.ts`
Expected: all 4 FAIL (`ERROR_METHOD_NOT_FOUND`; handler receives nothing).

- [ ] **Step 4: Write `src/methods/events.ts`**

```ts
import qs from 'qs';
import { defineMethod, type MethodContext } from '../bitrix.js';
import { EVENT_TIMEOUT_MS } from '../config.js';
import { memberId, portalDomain } from '../tokens.js';

export type EventItem = {
  client_id?: string;
  auth?: Record<string, unknown>;
  query: { QUERY_URL: string; QUERY_DATA?: Record<string, unknown> };
  additional?: Record<string, unknown>;
};

type EventCallBody = { QUERY: EventItem[] };

const eventCallSchema = {
  type: 'object',
  required: ['QUERY'],
  properties: {
    QUERY: {
      type: 'array',
      items: {
        type: 'object',
        required: ['query'],
        properties: {
          client_id: { type: 'string' },
          auth: { type: 'object' },
          additional: { type: 'object' },
          query: {
            type: 'object',
            required: ['QUERY_URL'],
            properties: { QUERY_URL: { type: 'string' }, QUERY_DATA: { type: 'object' } },
          },
        },
      },
    },
  },
} as const;

function buildAuth(ctx: MethodContext, item: EventItem): Record<string, unknown> {
  return {
    domain: portalDomain(ctx.portal),
    member_id: memberId(ctx.portal),
    application_token: item.auth?.application_token ?? '',
  };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

// One attempt, no retries; nothing survives a restart (stage 3 adds a persistent queue).
export async function deliver(ctx: MethodContext, item: EventItem): Promise<void> {
  const data = item.query.QUERY_DATA ?? {};
  const fields = {
    portal: ctx.portal.origin,
    client_id: item.client_id ?? null,
    event: data.event ?? null,
    url: item.query.QUERY_URL,
  };
  ctx.delivery.inFlight++;
  try {
    const auth = buildAuth(ctx, item);
    const body = qs.stringify({
      event: data.event,
      event_handler_id: data.event_handler_id,
      data: data.data,
      ts: data.ts,
      auth,
    });
    const response = await fetch(item.query.QUERY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (!response.ok) ctx.log.warn({ ...fields, status: response.status }, 'event_delivery_failed');
  } catch (error) {
    ctx.log.warn({ ...fields, error: errorText(error) }, 'event_delivery_failed');
  } finally {
    ctx.delivery.inFlight--;
  }
}

export const restEventCall = defineMethod<EventCallBody>(eventCallSchema, async (ctx, body) => {
  for (const item of body.QUERY) void deliver(ctx, item);
  return true;
});
```

`src/routes/rpc.ts` — import `restEventCall` from `../methods/events.js`; add `'rest.event.call': restEventCall,`.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src test
git commit -m "feat: accept rest.event.call and deliver events once without retries"
```

---

### Task 11: In-flight cap for event deliveries

- [ ] Task 11 complete: In-flight cap for event deliveries

tasks.md: **6.1** (cap)

**Files:**
- Modify: `src/methods/events.ts`
- Modify: `test/integration/event-delivery.test.ts`

**Interfaces:**
- Consumes: `EVENT_IN_FLIGHT_CAP` (200), `ctx.delivery.inFlight`.
- Produces: log message `event_dropped_overload` with the same `fields` as `event_delivery_failed`.

- [ ] **Step 1: Write the failing test**

```ts
  it('Overload', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    try {
      const items = Array.from({ length: 201 }, (_, i) => eventItem(handler.url, { event: `E${i}` }));

      const res = await rpc(t.app, portal, 'rest.event.call', { QUERY: items });

      expect(res.body).toEqual({ result: true });
      await vi.waitFor(
        () => {
          expect(handler.requests).toHaveLength(200);
        },
        { timeout: 5000 },
      );
      const dropped = t.logs.filter((l) => l.msg === 'event_dropped_overload');
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toMatchObject({ event: 'E200', url: handler.url });
    } finally {
      await handler.close();
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/integration/event-delivery.test.ts -t "Overload"`
Expected: FAIL — no `event_dropped_overload` log line (all 201 are sent).

- [ ] **Step 3: Implement** — in `deliver()`, directly after `const fields = {...};` and before `ctx.delivery.inFlight++;` (import `EVENT_IN_FLIGHT_CAP` from `../config.js`):

```ts
  if (ctx.delivery.inFlight >= EVENT_IN_FLIGHT_CAP) {
    // ponytail: in-memory cap, persistent queue in stage 3
    ctx.log.warn(fields, 'event_dropped_overload');
    return;
  }
```

The check and the increment run synchronously before the first `await`, so items 0–199 take the slots in order and item 200 is dropped deterministically.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: drop event deliveries above the in-flight cap"
```

---

### Task 12: User token in the event `auth` block

- [ ] Task 12 complete: User token in the event `auth` block

tasks.md: **6.2** (`sendAuth`, `sendRefreshToken`)

**Files:**
- Modify: `src/methods/events.ts`
- Modify: `test/integration/event-delivery.test.ts`

**Interfaces:**
- Consumes: `issuePair`, `applications`, `TokenResponse`.
- Produces: `buildAuth(ctx, item): Promise<Record<string, unknown>>`. Rule: `withUser = client_id set && Number(auth.LOCAL_USER) > 0 && additional.sendAuth === '1'` and the app belongs to the portal → token response of a new pair (`scope` = app scope, `userId` = `LOCAL_USER`, `params` = `item.auth`) minus `refresh_token` unless `additional.sendRefreshToken === '1'`, plus `application_token`; otherwise `{ domain, member_id, application_token }`.

- [ ] **Step 1: Write the failing test**

```ts
  it('Install event reaches a server-side app', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    const userAuth = { LOCAL_USER: '1', application_token: 'apptoken123' };
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONAPPINSTALL',
            auth: userAuth,
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONCRMDEALADD',
            auth: userAuth,
            additional: { sendAuth: '1', sendRefreshToken: '0' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      const byEvent = Object.fromEntries(
        handler.requests.map((r) => [String(r.event), r.auth as Record<string, unknown>]),
      );
      const install = byEvent.ONAPPINSTALL;
      expect(install).toMatchObject({
        domain: 'portal.test',
        member_id: md5(portal.client_id),
        application_token: 'apptoken123',
        user_id: '1',
        scope: 'crm,user',
        status: 'L',
      });
      expect(install.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(install.refresh_token).toMatch(/^[0-9a-f]{64}$/);
      expect(byEvent.ONCRMDEALADD.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(byEvent.ONCRMDEALADD).not.toHaveProperty('refresh_token');

      const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: String(install.access_token) });
      expect(checked.body.result).toMatchObject({ client_id: app.client_id, user_id: 1 });
    } finally {
      await handler.close();
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/integration/event-delivery.test.ts -t "Install event"`
Expected: FAIL — `auth` has no `access_token`.

- [ ] **Step 3: Implement** — replace `buildAuth` in `src/methods/events.ts` (add imports `and`, `eq` from `drizzle-orm`, `applications` from `../schema.js`, `issuePair` from `../tokens.js`) and change its call in `deliver()` to `const auth = await buildAuth(ctx, item);`

```ts
async function buildAuth(ctx: MethodContext, item: EventItem): Promise<Record<string, unknown>> {
  const applicationToken = item.auth?.application_token ?? '';
  const base = {
    domain: portalDomain(ctx.portal),
    member_id: memberId(ctx.portal),
    application_token: applicationToken,
  };
  const localUser = Number(item.auth?.LOCAL_USER ?? 0);
  const additional = item.additional ?? {};
  // PHP http_build_query sends booleans as "1" / "0".
  if (!item.client_id || !(localUser > 0) || additional.sendAuth !== '1') return base;
  const [app] = await ctx.db
    .select()
    .from(applications)
    .where(and(eq(applications.clientId, item.client_id), eq(applications.portalId, ctx.portal.id)))
    .limit(1);
  if (!app) return base;
  const { refresh_token, ...tokens } = await issuePair(ctx.db, ctx.config, app, ctx.portal, {
    scope: app.scope,
    userId: localUser,
    params: item.auth ?? {},
  });
  return {
    ...tokens,
    ...(additional.sendRefreshToken === '1' ? { refresh_token } : {}),
    application_token: applicationToken,
  };
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS (27 integration + 1 unit + health).

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: include a fresh user token in event auth when requested"
```

---

### Task 13: Server boot, token cleanup, container image, compose app service and CI

- [ ] Task 13 complete: Server boot, token cleanup, container image, compose app service and CI

tasks.md: **1.3**, **1.4** (CI)

Infrastructure task: no spec scenario, so no new automated test. Verification is a container smoke run plus the full suite in CI.

**Files:**
- Modify: `src/tokens.ts` (add `deleteExpiredPairs`), `src/server.ts`, `docker-compose.yml`
- Create: `Dockerfile`, `.dockerignore`, `.env.example`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `buildApp`, `createDb`, `loadConfig`, `PORT`, `CLEANUP_INTERVAL_MS`.
- Produces: `deleteExpiredPairs(db: Db, now: Date): Promise<void>`.

- [ ] **Step 1: Add cleanup and finish `src/server.ts`**

`src/tokens.ts` — append (add `lt` to the `drizzle-orm` import):
```ts
export async function deleteExpiredPairs(db: Db, now: Date): Promise<void> {
  await db.delete(tokenPairs).where(lt(tokenPairs.refreshExpiresAt, now));
}
```

`src/server.ts`:
```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from './app.js';
import { CLEANUP_INTERVAL_MS, loadConfig, PORT } from './config.js';
import { createDb } from './db.js';
import { deleteExpiredPairs } from './tokens.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
// ponytail: safe for one instance; add an advisory lock or a separate migrate command for several
await migrate(db, { migrationsFolder: 'drizzle' });
const app = await buildApp({ config, db });

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
```

- [ ] **Step 2: Write `Dockerfile`, `.dockerignore`, `.env.example`**

`Dockerfile` (DHI Node images; confirm the exact tags against the NTC Docker standard before the first build):
```dockerfile
FROM dhi.io/node:24-dev AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM dhi.io/node:24
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
EXPOSE 3000
# DHI runtime images run as a non-root user by default.
ENTRYPOINT ["node", "dist/server.js"]
```

`.dockerignore`:
```
node_modules
dist
test
docs
.git
.env
*.har
```

`.env.example`:
```
BASE_URL=https://auth.example.internal
DATABASE_URL=postgres://b24auth:b24auth@db:5432/b24auth
PORTAL_ALLOWLIST=portal.example.internal
```

- [ ] **Step 3: Add the `app` service to `docker-compose.yml`** (under `services:`, next to `db`)

```yaml
  app:
    build: .
    image: b24auth-server:local
    env_file: .env
    ports:
      - '3000:3000'
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 4: Smoke-run the container**

```bash
cp .env.example .env
sed -i 's#^BASE_URL=.*#BASE_URL=http://localhost:3000#; s#^PORTAL_ALLOWLIST=.*#PORTAL_ALLOWLIST=portal.test#' .env
docker compose up -d --build
curl -s http://localhost:3000/health
curl -s -X POST -d "redirect_uri=https://portal.test/&type=B" http://localhost:3000/oauth/register/
docker compose logs app | grep -c '"level":50'
docker compose down
```
Expected: `{"status":"ok"}`; a JSON object with `client_id` and `client_secret`; error log count `0`. (`docker login dhi.io` may be needed first.)

- [ ] **Step 5: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: b24auth
          POSTGRES_PASSWORD: b24auth
          POSTGRES_DB: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U b24auth"
          --health-interval 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - uses: docker/login-action@v3
        with:
          registry: dhi.io
          username: ${{ secrets.DHI_USERNAME }}
          password: ${{ secrets.DHI_TOKEN }}
      - run: docker build -t b24auth-server:ci .

  security:
    uses: NTC24/workflows/.github/workflows/ci-security.yml@main
```

Check the `ci-security.yml` inputs and pinned ref against the `ntc-versioning` skill and adjust before pushing. The `DHI_USERNAME` / `DHI_TOKEN` repository secrets are created by the user.

- [ ] **Step 6: Run the suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS; `dist/server.js` exists.

- [ ] **Step 7: Commit**

```bash
git add src Dockerfile .dockerignore .env.example docker-compose.yml .github
git commit -m "build: add container image, compose app service, token cleanup and CI"
```

---

### Task 14: Contract tests against captured cloud traffic

- [ ] Task 14 complete: Contract tests against captured cloud traffic

tasks.md: **7.1** — **blocked until Task 2 fixtures (`test/fixtures/cloud-capture.har`, `test/fixtures/event-handler.har`) are committed.** The suite skips itself while the fixtures are absent.

**Files:**
- Create: `test/contract/cloud-shapes.test.ts`
- Modify (only if a comparison fails): `src/tokens.ts`, `src/bitrix.ts`, `src/routes/*.ts`, `src/methods/*.ts`

**Interfaces:**
- Consumes: helpers `startApp`, `truncateAll`, `registerPortal`, `addApp`, `authorize`, `rpc`, `tokenRequest`, `startHandler`, `eventItem`, `form`.
- Produces: nothing for other tasks.

Expected shapes come only from the HAR files, never from our serializer. A difference means: fix our response, or — when the cloud field cannot exist here (e.g. a marketplace-only field) — add its path to `CLOUD_ONLY` with a one-line reason.

- [ ] **Step 1: Write the contract test**

`test/contract/cloud-shapes.test.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import qs from 'qs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addApp,
  authorize,
  eventItem,
  form,
  registerPortal,
  rpc,
  startApp,
  startHandler,
  tokenRequest,
  truncateAll,
  type TestApp,
} from '../helpers.js';

const CLOUD_HAR = 'test/fixtures/cloud-capture.har';
const HANDLER_HAR = 'test/fixtures/event-handler.har';

// Paths present in the cloud response that we deliberately do not return, with the reason.
const CLOUD_ONLY: Record<string, string> = {};

type HarEntry = {
  request: { method: string; url: string; postData?: { text?: string } };
  response: { status: number; content: { text?: string } };
};
type Shape = string | Shape[] | { [key: string]: Shape };

function entries(file: string): HarEntry[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { log: { entries: HarEntry[] } }).log.entries;
}

function cloudJson(
  pathPrefix: string,
  pick: (body: Record<string, unknown>) => boolean = () => true,
): Record<string, unknown> {
  for (const entry of entries(CLOUD_HAR)) {
    const text = entry.response.content.text;
    if (!new URL(entry.request.url).pathname.startsWith(pathPrefix) || !text) continue;
    const body = JSON.parse(text) as Record<string, unknown>;
    if (pick(body)) return body;
  }
  throw new Error(`No captured response for ${pathPrefix}`);
}

function shapeOf(value: unknown, path = ''): Shape {
  if (Array.isArray(value)) return value.length > 0 ? [shapeOf(value[0], `${path}[]`)] : [];
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !(`${path}${key}` in CLOUD_ONLY))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, shapeOf(item, `${path}${key}.`)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

const hasResult = (body: Record<string, unknown>): boolean => 'result' in body;
const hasError = (body: Record<string, unknown>): boolean => 'error' in body;

describe.skipIf(!existsSync(CLOUD_HAR))('contract: cloud response shapes', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
  });

  it('/oauth/register/', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: 'https://portal.test/', type: 'B' }),
    });
    expect(shapeOf(res.json())).toEqual(shapeOf(cloudJson('/oauth/register/')));
  });

  it('application.add', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.add', {
      TITLE: 'Demo',
      REDIRECT_URI: 'https://app.test/',
      SCOPE: 'crm,user',
    });
    expect(shapeOf(res.body)).toEqual(shapeOf(cloudJson('/rest/application.add', hasResult)));
  });

  it('rest.authorize', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const res = await rpc(t.app, portal, 'rest.authorize', {
      CLIENT_ID: app.client_id,
      SCOPE: 'crm,user',
      PARAMS: { LOCAL_USER: '1' },
    });
    expect(shapeOf(res.body)).toEqual(shapeOf(cloudJson('/rest/rest.authorize', hasResult)));
  });

  it('rest.check valid and invalid', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    const valid = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    const invalid = await rpc(t.app, portal, 'rest.check', { TOKEN: 'garbage' });
    expect(shapeOf(valid.body)).toEqual(shapeOf(cloudJson('/rest/rest.check', hasResult)));
    expect(invalid.body.error).toBe(cloudJson('/rest/rest.check', hasError).error);
  });

  it('/oauth/token/ refresh, invalid grant and unsupported grant', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    const base = { client_id: app.client_id, client_secret: app.client_secret };
    const renewed = await tokenRequest(t.app, 'GET', {
      ...base,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    });
    const badGrant = await tokenRequest(t.app, 'GET', {
      ...base,
      grant_type: 'refresh_token',
      refresh_token: 'garbage',
    });
    const badType = await tokenRequest(t.app, 'GET', { ...base, grant_type: 'authorization_code' });

    expect(shapeOf(renewed.json())).toEqual(
      shapeOf(cloudJson('/oauth/token/', (b) => 'access_token' in b)),
    );
    const cloudErrors = entries(CLOUD_HAR)
      .filter((e) => new URL(e.request.url).pathname.startsWith('/oauth/token/'))
      .map((e) => (JSON.parse(e.response.content.text ?? '{}') as { error?: string }).error)
      .filter((code): code is string => code !== undefined);
    expect(cloudErrors).toContain(badGrant.json<{ error: string }>().error);
    expect(cloudErrors).toContain(badType.json<{ error: string }>().error);
  });

  it.skipIf(!existsSync(HANDLER_HAR))('event POST body', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONAPPINSTALL',
            auth: { LOCAL_USER: '1', application_token: 'x' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });
      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      const captured = entries(HANDLER_HAR).find((e) => e.request.method === 'POST');
      const cloudBody = qs.parse(captured?.request.postData?.text ?? '', { depth: 20 });
      // Compare top-level keys and auth keys only; event data differs by event.
      expect(Object.keys(handler.requests[0]).sort()).toEqual(Object.keys(cloudBody).sort());
      expect(shapeOf(handler.requests[0].auth)).toEqual(shapeOf(cloudBody.auth));
    } finally {
      await handler.close();
    }
  });
});
```

- [ ] **Step 2: Run against the fixtures**

Run: `npx vitest run test/contract`
Expected: either PASS, or FAIL with a concrete shape diff. Before fixtures exist: suite reported as skipped.

- [ ] **Step 3: Resolve every diff**

For each failing comparison, one of:
- Path form differs (e.g. cloud RPC path is `/rest/rest.check.json`): add the alias route in `src/routes/rpc.ts` (register `/rest/${name}.json` in the same loop) and match it in `cloudJson`.
- Field missing or wrong type in our response: fix `tokenResponse()` / `check()` in `src/tokens.ts` or the method's return value; re-run the matching integration test file to keep it green.
- Cloud-only field that cannot exist offline (marketplace/licence): add `'<path>': '<reason>'` to `CLOUD_ONLY`.
- Error code or HTTP status differs: change the code/status in the `fail()` call and update the matching integration test assertion.
- Cloud **rejects** refresh reuse (results table in `docs/protocol-capture.md`): stop; this reopens the token-service spec in Comet (Design Doc §10). Do not change behaviour silently.

Run after each fix: `npm test`
Expected: all PASS.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add test/contract src test/integration
git commit -m "test: compare response shapes with captured cloud traffic"
```

---

### Task 15: End-to-end checklist on the test portal (manual)

- [ ] Task 15 complete: End-to-end checklist on the test portal (manual)

tasks.md: **7.2** — also the real proof of the "Install URL of a local app still runs" scenario.

**Files:**
- Create: `docs/e2e-checklist.md`

- [ ] **Step 1: Write `docs/e2e-checklist.md`**

```markdown
# End-to-end check on a test portal without internet

Run before each release. Record date, portal version, server image tag and the result of
every step in the table at the end.

## Setup

1. Deploy the server per `docs/deployment.md` on a host the portal reaches; block the portal's
   outbound internet access (firewall rule or isolated network). Confirm
   `curl https://oauth.bitrix.info` fails from the portal host.
2. Point the portal at the server and force registration:

       \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://<server>');
       \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
       \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

## Local app with UI

3. Create a local app with a handler page and an install page (`URL_INSTALL`) that calls
   `BX24.installFinish()`. Scope `crm,user`. Server log shows `application.add`.
4. Open the app as admin. Expected: the install page opens with tokens (`rest.authorize`),
   `BX24.installFinish()` completes, the portal marks the app installed (no server call for it).
5. Open the app again. Expected: the main page opens; `BX24.callMethod('user.current')`
   returns the admin user (`rest.check` in the server log).
6. Open the app as a non-admin user. Expected: `user.current` returns that user.

## Server-side local app

7. Create a server-side local app with handler URL on an internal host that logs POST bodies.
   Expected: the handler receives `ONAPPINSTALL` with `auth.access_token`,
   `auth.refresh_token`, `auth.domain`, `auth.member_id`, `auth.application_token`.
8. Call `https://<portal>/rest/profile?auth=<access_token from step 7>`. Expected: success.

## Renewal

9. For both apps, renew through the server:

       curl "https://<server>/oauth/token/?grant_type=refresh_token&client_id=<id>&client_secret=<secret>&refresh_token=<refresh>"

   Expected: new pair; the new access token works for a portal REST call. Repeat with the same
   refresh token: expected another new pair.

## Delete

10. Delete the UI app. Expected: its old access token is rejected by portal REST after the
    portal's 3600 s `rest.check` cache expires (or after clearing the portal cache).

## Results

| Step | Result | Notes |
|---|---|---|
| 1–10 | | |
```

- [ ] **Step 2: Commit**

```bash
git add docs/e2e-checklist.md
git commit -m "docs: add end-to-end checklist for an offline test portal"
```

- [ ] **Step 3 (user): Run the checklist on the test portal and record results** — failures go back to Build as new tasks.

---

### Task 16: Deployment guide

- [ ] Task 16 complete: Deployment guide

tasks.md: **7.3**

**Files:**
- Create: `docs/deployment.md`

- [ ] **Step 1: Write `docs/deployment.md`** with these sections and content:

```markdown
# Deploying b24auth-server in a closed network

## 1. What you deploy

One container (`b24auth-server`) and one PostgreSQL 17 database. TLS terminates at your
reverse proxy; the service listens on plain HTTP port 3000. One server can serve several
portals.

## 2. Move the image into the closed network

On a machine with internet access:

    docker build -t b24auth-server:<version> .
    docker pull postgres:17
    docker save b24auth-server:<version> postgres:17 -o b24auth-server-<version>.tar

Copy the tar file and `docker-compose.yml` into the closed network, then:

    docker load -i b24auth-server-<version>.tar

## 3. Configure

Create `.env` next to `docker-compose.yml`:

| Variable | Example | Meaning |
|---|---|---|
| `BASE_URL` | `https://auth.corp.local` | Public URL behind the proxy; becomes `server_endpoint` |
| `DATABASE_URL` | `postgres://b24auth:<password>@db:5432/b24auth` | Database connection |
| `PORTAL_ALLOWLIST` | `portal.corp.local,crm.corp.local:8443` | Portal `host[:port]` allowed to register; exact, case-insensitive |

Set `POSTGRES_PASSWORD` in `.env` to the same password. Start: `docker compose up -d`.
Migrations run on start. Check: `curl https://auth.corp.local/health` → `{"status":"ok"}`.
Run one app instance only (migrations on boot are not locked).

## 4. Reverse proxy and TLS

Proxy `https://<BASE_URL host>/` to `http://<app host>:3000/`. Use a certificate from your
internal CA that the portal servers and application servers trust.

## 5. Switch the portal

On the portal ("PHP command line" in the admin panel):

    \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://auth.corp.local');
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

Alternative: define `BITRIX_OAUTH_URL` in `bitrix/php_interface/dbconn.php`. The portal
registers itself on its next OAuth call. Registering again later (same deletion) issues new
service credentials; apps and tokens are kept.

## 6. Re-create local applications

Local apps created while the portal used the cloud have credentials only the cloud knows.
Re-create each local app on the portal (Developer resources → Other → Local application) and
update its `client_id` / `client_secret` in the application's own configuration.
Marketplace applications are not supported in a closed network.

## 7. Application token renewal URL

Applications renew tokens at `/oauth/token/`. Most SDKs (CRest, official SDKs) hard-code
`https://oauth.bitrix.info/oauth/token/`. Choose one:
- Change the application's configuration to `https://auth.corp.local/oauth/token/`
  (preferred).
- Or point DNS for `oauth.bitrix.info` (and `oauth.bitrix24.tech`) to the reverse proxy and
  issue a certificate for those names from the internal CA trusted by application servers.

## 8. Events

Event handlers receive one POST per event with a 10 s timeout; no retries. Failed and dropped
deliveries appear in the container log as `event_delivery_failed` / `event_dropped_overload`.
Pending deliveries are lost on restart.

## 9. Operations

- Logs: JSON to stdout (`docker compose logs app`).
- Expired token pairs are deleted hourly.
- Backup: standard PostgreSQL dumps of the `b24auth` database.

## 10. Rollback

1. On the portal: `\Bitrix\Main\Config\Option::delete('rest', ['name' => 'oauth_server']);`
   and delete `service_client_id` / `service_client_secret` as in section 5.
2. The portal re-registers with the cloud when internet access is available.
3. Local apps created against this server must be re-created again; their tokens stop working.
4. Stop the service: `docker compose down` (keep the volume until you are sure).
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add deployment guide for closed networks"
```

---

## Open items the plan cannot resolve

- CTO exception approval for Node.js (Task 1 README fields) — user.
- Protocol capture (Task 2 Step 5) — user; Task 14 is blocked until then. If the cloud rejects refresh reuse, the token-service spec is reopened.
- Exact DHI image tags and `dhi.io` CI credentials (`DHI_USERNAME`, `DHI_TOKEN`) — Task 13; confirm against the NTC Docker standard.
- `ci-security.yml` inputs and ref — confirm with the `ntc-versioning` skill (Task 13).
- HTTP status codes (400/401) and RPC path form are best guesses until Task 14 compares them with the capture.
