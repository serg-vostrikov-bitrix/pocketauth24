---
comet_change: admin-panel
role: technical-design
canonical_spec: openspec
---

# Admin panel: technical design

This document refines `docs/openspec/changes/admin-panel/design.md`. The OpenSpec delta specs (`admin-auth`, `admin-users`, `admin-data-browser`) are the canonical requirements. This document does not repeat them.

Starting point on `main`: Fastify 5 app in `src/app.ts`, `web/` React 19 + Vite package with `theme.css`, `Gyroscope.tsx` and the status page, `src/static.ts` that serves the build, the hourly cleanup in `src/server.ts`.

## 1. File layout

```
src/
  cli.ts                     superuser set-password
  admin/
    password.ts              hashPassword, verifyPassword, generatePassword
    users.ts                 data access for admin_users (also used by the CLI)
    sessions.ts              createSession, findSession, deleteSession, deleteExpiredSessions
    rateLimit.ts             createLoginLimiter
    auth.ts                  cookie, session preHandler, JSON guard, login/logout/me routes
    usersRoutes.ts           user management routes (superuser only)
    filters.ts               column definitions → Drizzle conditions, pagination
    dataRoutes.ts            portals, applications, tokens, events (GET only)
    index.ts                 registerAdmin(app, deps): registers the four route modules under /api/admin
web/src/
  main.tsx                   router: "/" → StatusPage, "/admin/*" → lazy AdminApp
  admin/
    AdminApp.tsx             routes, session check, layout
    api.ts                   fetch wrapper (JSON, 401 → login)
    LoginPage.tsx            gyroscope, form, "run the CLI" state
    Layout.tsx               sidebar, user, logout
    DataTable.tsx            column config, filter row, URL state, debounce, pagination
    pages.tsx                Portals, Applications, Tokens, Events (DataTable configs)
    UsersPage.tsx            list, create, reset, delete, one-time password dialog
    admin.css
```

## 2. Data model (Drizzle migration)

```
admin_users
  id            bigserial primary key
  login         text not null unique
  password_hash text not null
  role          text not null check (role in ('superuser','viewer'))
  created_at    timestamptz not null default now()
  unique index admin_users_one_superuser on (role) where role = 'superuser'

admin_sessions
  id_hash    text primary key            sha256 hex of the cookie value
  user_id    bigint not null references admin_users(id) on delete cascade
  expires_at timestamptz not null
  index on (expires_at)
```

- Delete of a user removes its sessions through the cascade.
- Password reset and the CLI call `deleteSessionsOfUser(userId)` in the same transaction as the password update.

## 3. Passwords (`src/admin/password.ts`)

- `hashPassword(plain)`: `scrypt(plain, salt16, 64, { N: 32768, r: 8, p: 1, maxmem: 64 MiB })` through the promise form of `node:crypto`. Format: `scrypt$32768$8$1$<salt b64>$<hash b64>`.
- `verifyPassword(plain, stored)`: parses the parameters, recomputes, compares with `timingSafeEqual`. Returns `false` for a malformed value; never throws.
- `DUMMY_HASH`: a hash of a random value, computed once at module load. Login calls `verifyPassword(password, DUMMY_HASH)` when the login does not exist, so the response time does not reveal valid logins.
- `generatePassword()`: 20 characters from `[A-Za-z0-9]` via `crypto.randomInt` (about 119 bits).
- `MIN_PASSWORD_LENGTH = 12` in `src/config.ts` (CLI only; generated passwords have 20).

## 4. CLI (`src/cli.ts`)

- Entry: `node dist/cli.js superuser set-password [--login <name>] [--password-stdin]`, parsed with `util.parseArgs` (`strict: true`; unknown flags such as `--password` fail).
- Reads only `DATABASE_URL` (a new `requiredEnv` export from `src/config.ts`); does not need `BASE_URL` or the allowlist.
- Runs Drizzle migrations first, so it works before the first server start.
- Password input:
  - `--password-stdin`: reads the first line of stdin, strips the trailing newline.
  - Otherwise: requires `process.stdin.isTTY`, else exits with code 2 and a message to use `--password-stdin`. Prompts twice with raw mode; echoes nothing; handles Backspace, Enter, Ctrl+C (exit 130).
- Validation: length ≥ 12, the two inputs equal, login matches `^[A-Za-z0-9._-]{3,64}$` (default `admin`). Any failure: exit code 1, nothing changed.
- Effect (`setSuperuser(db, login, hash)` in `src/admin/users.ts`, one transaction): if a superuser exists, update its login and hash and delete its sessions; else insert. If the new login belongs to a viewer, exit 1 with a message.
- Output: `Superuser "<login>" saved.` Never prints the password.

## 5. HTTP API

All routes live under `/api/admin`. The plugin `registerAdmin` sets `Cache-Control: no-store` on every response.

### 5.1 Auth (`src/admin/auth.ts`)

- `@fastify/cookie`. Cookie `b24a_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, `Secure` when `NODE_ENV === 'production'`.
- `onRequest` JSON guard: for `POST`, `PUT`, `PATCH` and `DELETE`, the `content-type` must start with `application/json`, else 415 before any handler runs. The client sends `{}` as the body of a `DELETE`.
- `preHandler` session check on every route except `POST /login`: hash the cookie, `select ... join admin_users where id_hash = $1 and expires_at > now()`. Missing → 401 `{"error":"unauthorized"}`. On success, `request.adminUser = { id, login, role }`.
- `POST /login` `{ login, password }` (JSON schema: strings, max 256):
  1. Limiter blocked for `request.ip` → 429 `{"error":"too_many_attempts"}` without password work.
  2. No superuser in `admin_users` → 503 `{"error":"no_superuser","hint":"docker compose exec app node dist/cli.js superuser set-password"}`.
  3. Look up the login; verify against its hash or `DUMMY_HASH`.
  4. Failure → limiter `fail(ip)`, log `admin_login_failed { login, ip }`, 401 `{"error":"invalid_credentials"}`.
  5. Success → limiter `reset(ip)`, create a session (32 random bytes, base64url), set the cookie, log `admin_login_succeeded { login, ip }`, 200 `{ login, role }`.
- `POST /logout`: delete the session, clear the cookie, log `admin_logout { login, ip }`, 204.
- `GET /me`: 200 `{ login, role }`.
- `TRUST_PROXY` env (`true`/`false`, default `false`) → Fastify `trustProxy` in `buildApp`. Only then does `request.ip` use `X-Forwarded-For`.

### 5.2 Rate limit (`src/admin/rateLimit.ts`)

`createLoginLimiter({ max: 5, windowMs: 15 * 60_000 })` uses `Date.now()` and returns `{ blocked(ip), fail(ip), reset(ip) }`. It keeps `Map<ip, number[]>` of failure times and drops times outside the window on each call. A sweep on each `fail` removes empty entries, so memory stays bounded by active attackers. One instance per app.

### 5.3 Users (`src/admin/usersRoutes.ts`)

A `preHandler` returns 403 `{"error":"forbidden"}` unless `request.adminUser.role === 'superuser'`.

| Route | Body | Result |
|---|---|---|
| `GET /users` | — | `[{ id, login, role, createdAt }]`, superuser first |
| `POST /users` | `{ login }` | 201 `{ id, login, password }`; 409 if the login exists; 400 if the login is invalid |
| `POST /users/:id/password` | `{}` | 200 `{ password }`; revokes sessions; 403 if the target is the superuser; 404 if missing |
| `DELETE /users/:id` | `{}` | 204; sessions go by cascade; 403 if the target is the superuser; 404 if missing |

Passwords in responses are never logged. The response serializer is the default JSON; the `password` field appears only in these two responses.

### 5.4 Data browser (`src/admin/filters.ts`, `src/admin/dataRoutes.ts`)

Column definition:

```ts
type Column = {
  key: string;                       // query key and JSON field
  sql: SQL | AnyColumn;              // Drizzle expression
  filter: 'text' | 'id' | 'date' | 'enum' | 'none';
  values?: readonly string[];        // enum values
};
```

- Query format: `filter[<key>]=<value>`; dates as `filter[<key>.from]` and `filter[<key>.to]` (ISO date or date-time; `to` of a date-only value is inclusive to the end of that day); `page=<n>` (1-based). Fastify's default query parser keeps `filter[x]` as a literal key.
- `text` → `ilike(expr, '%' + escapeLike(value) + '%')`, where `escapeLike` escapes `\`, `%`, `_`. `id` → integer check, else 400; `eq`. `date` → `gte`/`lt`. `enum` → value must be in `values`, else 400.
- Unknown keys are ignored. Empty values are ignored.
- Each endpoint runs two queries with the same `where`: `count(*)` and the page (`order by <newest> desc, id desc limit 50 offset (page-1)*50`). Response: `{ rows, total, page, pageSize: 50 }`.

| Endpoint | Columns (filter type) | Order |
|---|---|---|
| `GET /portals` | id (id), origin (text), clientId (text), applications (none; `count` subquery), createdAt (date) | createdAt |
| `GET /applications` | id (id), portal (text, `portals.origin`), clientId (text), title (text), redirectUri (text), scope (text), createdAt (date) | createdAt |
| `GET /tokens` | id (id), portal (text), application (text, `applications.title`), clientId (text, `applications.client_id`), userId (id), scope (text), createdAt (date), accessExpiresAt (date), refreshExpiresAt (date), state (enum `active`/`expired` → `access_expires_at > now()` or `<=`) | createdAt |
| `GET /events` | day (date), outcome (enum `delivered`/`failed`/`dropped`), count (none) | day |

The `select` lists name each field explicitly. No query selects `secret_hash`, `access_hash`, `refresh_hash` or `params`.

### 5.5 Registration and cleanup

- `buildApp` calls `registerAdmin(app, deps)` before `registerWeb`.
- `registerWeb` adds `GET /admin` and `GET /admin/*` that send `index.html` with the same headers as `/`.
- `src/server.ts`: the hourly job also runs `deleteExpiredSessions(db, now)`; failures log `session_cleanup_failed`.

## 6. Frontend

- New dependency: `react-router` (v7, `BrowserRouter`). `main.tsx` routes `/` to `StatusPage` and `/admin/*` to `lazy(() => import('./admin/AdminApp'))`. The status page bundle does not include the admin code.
- `admin/api.ts`: `apiGet(path, params)` and `apiSend(method, path, body)`; `credentials: 'same-origin'`; `content-type: application/json` on every write; on 401 the app navigates to `/admin/login`.
- `AdminApp`: on mount `GET /me`; 401 → login page. Routes: `login`, `portals` (default), `applications`, `tokens`, `events`, `users` (registered only for the superuser; for a viewer the URL falls back to `portals`).
- `LoginPage`: the gyroscope (smaller, `clamp(100px, 20vw, 160px)`), login and password fields, error text per error code (`invalid_credentials`, `too_many_attempts`, `no_superuser` shows the CLI command from `hint` in a code block).
- `Layout`: left sidebar (Portals, Applications, Tokens, Event counters, Users for the superuser), current login and role, Log out. On narrow screens (< 720 px) the sidebar becomes a top bar.
- `DataTable`: props `{ endpoint, columns }`. A filter row under the headers: text input for `text`/`id`, select for `enum`, two date inputs for `date`. State lives in the URL (`useSearchParams`); typing updates the URL after 300 ms; page resets to 1 on a filter change. Shows `total`, page controls, a loading state, and an empty state "No matching rows". Rows fade in with the existing `fade-in` keyframes. Long values are cut with an ellipsis and show the full value in `title`.
- `UsersPage`: table of users; "New viewer" (login input) and "Reset password" open a dialog that shows the generated password once with a Copy button and the text "This password is shown once."; "Delete" asks for confirmation. No action buttons on the superuser row.
- Styles: `admin.css` uses the tokens of `theme.css`. The reduced-motion block of `theme.css` already covers the new animations.

## 7. Edge cases

| Case | Behavior |
|---|---|
| No superuser | Login 503 with the CLI hint; the login page shows the command |
| Superuser login renamed by the CLI | Old sessions revoked; the user logs in with the new login |
| CLI login equals a viewer login | Exit 1, nothing changed |
| Two superusers by a race | The partial unique index rejects the second insert |
| Viewer deleted while browsing | Next request 401 → login page |
| Cookie from an expired session | 401; the hourly job deletes the row |
| `filter[id]=abc` | 400 `{"error":"invalid_filter","column":"id"}` |
| `filter[portal]=100%` | `%` is escaped and matches a literal `%` |
| Page beyond the last | Empty `rows`, correct `total` |
| Cross-site form post | 415 by the JSON guard; `SameSite=Strict` also drops the cookie |
| Proxy without `TRUST_PROXY` | All clients share the proxy IP for the rate limit; documented |

## 8. Testing

Integration tests with real PostgreSQL, through `app.inject`, unless noted.

| File | Covers |
|---|---|
| `test/unit/password.test.ts` | hash/verify round trip, different hashes for equal passwords, malformed value → false, generated length and charset |
| `test/integration/admin-cli.test.ts` | spawn `tsx src/cli.ts` with `--password-stdin`: creates the superuser; second run replaces the hash and deletes its sessions; short password exit 1; `--password` flag rejected; login of a viewer exit 1 |
| `test/integration/admin-auth.test.ts` | 503 without superuser; no cookie on a protected route 401; success sets the cookie with the flags; wrong password and unknown login give the same 401 body; sixth failure 429; expired session 401; logout 204 then 401; 415 for form-encoded POST; logs contain the login and no password |
| `test/integration/admin-users.test.ts` | create returns a 20-character password that logs in; reset returns a new one, old password and old session fail; delete → the viewer's session 401; viewer gets 403 on every user route; actions on the superuser 403; duplicate login 409 |
| `test/integration/admin-data.test.ts` | each endpoint returns the documented fields and none of `secret_hash`, `access_hash`, `refresh_hash`, `params`; filter combination (portal + userId); token state filter; date range; injection string returns only matching rows; `%` escaped; 51 rows → page 1 has 50 and total 51; `DELETE /api/admin/tokens/1` returns 404 (no write routes) |
| `test/integration/static.test.ts` | `/admin/tokens` returns `index.html` with the CSP header |

Helpers: `createSuperuser(db)` and `loginAs(app, login, password)` in `test/helpers.ts`; `truncateAll` adds `admin_users` and `admin_sessions`.

Manual checks before verify: the hidden TTY prompt in a real terminal; the admin UI in a browser (login, the CLI hint state, filters, pagination, the users flow, the one-time password dialog, the narrow layout).

## 9. Clarifications of the delta specs

The delta specs are frozen after the design handoff. These two user decisions refine them without a contradiction:

1. **Viewer passwords (`admin-users`, "Superuser manages viewers").** On create and on password reset, the server generates the new password (20 characters from `[A-Za-z0-9]`) and returns it once in the response. The superuser does not type a password. This satisfies "A new password SHALL have at least 12 characters". The scenario "Create a viewer … with a unique login and a valid password" is met by the generated password.
2. **Token state (`admin-data-browser`, "Search by fields").** The state of a token pair uses the access token expiry: `active` when `access_expires_at > now()`, else `expired`. Pairs with an expired refresh token are deleted by the hourly cleanup and do not appear for long.

## 10. Implementation Divergence

Recorded in the verify phase on 2026-11-19. The delta specs are unchanged and satisfied. The OpenSpec `design.md` is frozen after the design handoff; items 1 and 7 also supersede its D6 and D5.

1. **Session cookie `Secure` (section 5.1; OpenSpec design D6).** The cookie always has `Secure`. The `admin-auth` spec requires it. Browsers accept a `Secure` cookie on `http://localhost`, so local development still works.
2. **Login rate limit (sections 5.1 and 5.2).** The limiter API is `tryAttempt(ip)` / `refund(ip)`. The login handler reserves the attempt before any `await` and refunds it on success, on 503 and on a thrown error. Only a wrong password keeps it. A successful login does not clear earlier failures. Reason: a check-then-act race let a parallel burst bypass the limit; user decision on 2026-11-19.
3. **Guard phase (sections 1, 5.1, 5.3).** The session check and the superuser check are `onRequest` hooks, not `preHandler`. Reason: the `admin-auth` spec requires 401 on every protected route; with `preHandler`, schema validation answered first with 400.
4. **CLI login (section 4).** Without `--login`, the CLI keeps the current superuser login. It uses `admin` only for the first superuser. Reason: the `admin-auth` spec text.
5. **Event counters order (section 5.4).** Events sort by `day desc, outcome asc`. The table has no `id` column.
6. **Input bounds (sections 5.3, 5.4).** `id` filters accept at most 9 digits. Path ids accept safe integers only. Impossible calendar dates and time-zone offsets of 16 hours or more get 400. A date-only `to` of `9999-12-31` means no upper bound. Reason: these inputs reached PostgreSQL and caused HTTP 500.
7. **`TRUST_PROXY` (section 5.1; OpenSpec design D5).** The variable accepts only `true` or `false`; any other value stops the server at boot. The proxy must overwrite `X-Forwarded-For` with `$remote_addr`, because Fastify `trustProxy: true` takes the left-most entry, which a client controls.
8. **Additions.** The admin scope has its own 404 handler with `no-store`. The JSON guard compares the content type case-insensitively. The CLI prints a fixed message plus the database cause on a failure, never the query parameters.
