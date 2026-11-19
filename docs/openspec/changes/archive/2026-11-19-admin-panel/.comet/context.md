# Comet Design Handoff

- Change: admin-panel
- Phase: design
- Mode: compact
- Context hash: bcb0d846f020272316af3bcd995cce3e6ea5ac1c9b7ad13cec8da3016bbc5bf0

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/admin-panel/proposal.md

- Source: docs/openspec/changes/admin-panel/proposal.md
- Lines: 1-41
- SHA256: 36d7d22dc0ebdbcb090f229338f79657dfad8fa56865972a3b7787bf1498ecf3

```md
## Why

Operators of b24auth-server cannot see which portals, local applications and tokens the server holds without direct SQL access to PostgreSQL. This change adds a multi-user admin panel with read-only views of the service data and a superuser whose password only the service CLI can set.

This is item 2 of 2 of backlog issue #6 (sub-issue #8). It depends on `public-status-page`, which adds the React frontend skeleton and the event counters.

## What Changes

- Add a CLI command that sets the superuser login and password. The password comes only from a hidden TTY prompt or from stdin.
- Add admin users, password hashes and sessions to the database.
- Add login and logout with a session cookie, a login rate limit and session revocation.
- The superuser creates and deletes admin users and resets their passwords in the panel. The panel cannot change the superuser.
- All admins see read-only tables of portals, local applications, token metadata and daily event counters. Each table filters by its fields.
- The admin UI lives at `/admin` in the React application. The admin JSON API lives at `/api/admin/*`.

## Capabilities

### New Capabilities

- `admin-auth`: superuser setup through the CLI, password storage, login, logout, sessions and the login rate limit.
- `admin-users`: management of admin users by the superuser.
- `admin-data-browser`: read-only, searchable tables of portals, applications, token metadata and event counters.

### Modified Capabilities

- None.

## Impact

- New tables `admin_users`, `admin_sessions` and a Drizzle migration.
- New `src/cli.ts`, `src/admin/*` (auth, users, data API); route registration in `src/app.ts`.
- New dependency `@fastify/cookie` on the server. Password hashing uses `scrypt` from `node:crypto`, no native module.
- `web/`: login page and admin layout in the dark theme of `public-status-page`, user management page, four data tables with filters.
- `docs/deployment.md`: superuser setup, the recommendation to restrict `/admin` and `/api/admin` at the proxy.

## Non-goals

- Edit or delete of portals, applications, tokens or counters.
- Token values or hashes, application secrets in any admin view.
- SSO, LDAP, two-factor authentication, fine-grained permissions.
- An audit log of admin actions. Only login events go to the server log.

```

## docs/openspec/changes/admin-panel/design.md

- Source: docs/openspec/changes/admin-panel/design.md
- Lines: 1-64
- SHA256: 7e3584dcd7a1886cc4bb1c0617ba93cc922f86840c99d01a5281705819453b7a

```md
## Context

`public-status-page` adds `web/` (React + Vite) served by `@fastify/static`, and the table `event_counters`. This change adds the admin side on top. The service often runs in a closed network behind a reverse proxy that terminates TLS. Tokens and secrets are stored only as hashes, and admin data must keep that property.

## Goals / Non-Goals

**Goals:**
- A superuser that only shell access to the container can create or change.
- Viewers that the superuser manages in the panel.
- Read-only, searchable views of portals, applications, token metadata and event counters.

**Non-Goals:**
- Writes to service data, an audit log, SSO, 2FA, fine-grained permissions.

## Decisions

### D1. CLI entry `dist/cli.js`, password from TTY or stdin only
`docker compose exec app node dist/cli.js superuser set-password`. The command reads the password twice with raw-mode TTY input that echoes nothing. `--password-stdin` reads one line for automation. Arguments and environment variables are rejected, because they leak to shell history, `ps` and `docker inspect`. The command connects with `DATABASE_URL` from the container environment.

- Alternative: a `SUPERUSER_PASSWORD` environment variable on boot. Rejected: it stays in the container config and in the `docker inspect` output.
- Alternative: a one-time setup token in the log for the first web login. Rejected: logs often go to shared systems.

### D2. scrypt from `node:crypto`
Parameters N=2^15, r=8, p=1, 64-byte key, 16-byte random salt. Stored format: `scrypt$N$r$p$salt_b64$hash_b64`, so the parameters can change later. Compare with `timingSafeEqual`.

- Alternative: Argon2id through the `argon2` package. Rejected for now: a native module complicates the Alpine image, and scrypt is memory-hard and built in.

### D3. Database sessions with hashed IDs
Table `admin_sessions (id_hash, user_id, expires_at)`. The cookie holds a random 32-byte ID, and the database holds its SHA-256, the same approach as for tokens. Revocation is a `DELETE` by user ID. A session has a fixed 12-hour lifetime and no idle timeout, so a request never writes to the session table. The existing hourly cleanup deletes expired sessions.

- Alternative: signed stateless cookies (JWT). Rejected: revocation on password change needs server state anyway.

### D4. One table `admin_users` with a role column
`admin_users (id, login unique, password_hash, role, created_at)`, where `role` is `superuser` or `viewer`. A partial unique index on `role` where `role = 'superuser'` makes sure that at most one superuser exists.

### D5. In-memory login rate limit
A map from IP address to failure timestamps, 5 failures in 15 minutes. One instance is the supported deployment. The client IP comes from `request.ip`. A new environment variable `TRUST_PROXY` enables Fastify `trustProxy`; `docs/deployment.md` tells the operator to set it only when the proxy sets `X-Forwarded-For`.

### D6. CSRF protection by `SameSite=Strict` and a JSON-only API
No CSRF token is necessary: a browser does not send a cross-site JSON request without a CORS preflight, and the server enables no CORS. The `Secure` cookie flag requires HTTPS at the proxy. For local development over HTTP, the server drops `Secure` when `NODE_ENV` is not `production`.

### D7. Filters as a whitelist per table
Each table has a declared list of columns with a filter type: text, id, date range or enum. The API reads `filter[<column>]` query parameters, ignores unknown columns and builds Drizzle conditions (`ilike`, `eq`, `between`). The sort order is fixed: newest first. Text search uses `ILIKE '%...%'` with escaped `%` and `_`. At the expected table sizes (thousands of rows), no extra index is necessary.

### D8. UI routing
React Router with the base `/admin`. Fastify serves `index.html` for `/admin` and `/admin/*`. All other unknown paths keep the JSON 404. The admin API is under `/api/admin/*`.

## Risks / Trade-offs

- [The admin panel is reachable wherever `/` is reachable] → The docs recommend a network allowlist for `/admin` and `/api/admin` at the proxy. The rate limit and the absence of a default password reduce the risk.
- [The in-memory rate limit resets on restart] → Acceptable for one instance. Note it for a future multi-instance setup.
- [`ILIKE '%x%'` does a sequential scan] → The tables are small. Add `pg_trgm` indexes only if a real installation needs them.
- [The superuser login name is visible in logs] → The login is not a secret. Passwords and session IDs never reach logs.

## Migration Plan

1. Deploy the image. The boot migration adds `admin_users` and `admin_sessions`.
2. Run the CLI command to set the superuser password.
3. Add the proxy restriction for `/admin` and `/api/admin`.
4. Rollback: deploy the previous image. The extra tables do no harm.

## Open Questions

- None blocking. The exact UI layout is decided in the design phase.

```

## docs/openspec/changes/admin-panel/tasks.md

- Source: docs/openspec/changes/admin-panel/tasks.md
- Lines: 1-40
- SHA256: f36f717780c8dba5ffddab634ae08b2d87f1409f5842bd4e63573cfe65c3f492

```md
## 1. Data and password primitives

- [ ] 1.1 Add `admin_users` and `admin_sessions` to `src/schema.ts`; generate the migration with the partial unique index for the superuser
- [ ] 1.2 `src/admin/password.ts`: scrypt hash and verify with `timingSafeEqual`; unit tests

## 2. CLI

- [ ] 2.1 `src/cli.ts` with `superuser set-password`: hidden TTY prompt twice, `--password-stdin`, `--login`, length check
- [ ] 2.2 Create or update the superuser and revoke its sessions; integration tests

## 3. Auth API

- [ ] 3.1 Register `@fastify/cookie`; session create, lookup, 12-hour expiry, revoke
- [ ] 3.2 `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`; HTTP 503 without a superuser
- [ ] 3.3 Rate limit, JSON-only guard for writes, login logging, `TRUST_PROXY` config
- [ ] 3.4 Add expired session cleanup to the hourly job; integration tests

## 4. User management API

- [ ] 4.1 List, create, delete viewers and reset a viewer password (superuser only)
- [ ] 4.2 HTTP 403 rules for superuser changes and for viewers
- [ ] 4.3 Integration tests

## 5. Data browser API

- [ ] 5.1 Filter whitelist helper: text, id, date range, enum; pagination
- [ ] 5.2 GET endpoints for portals, applications, tokens and event counters without secret fields
- [ ] 5.3 Integration tests, including filter combinations and an injection attempt

## 6. Admin UI

- [ ] 6.1 React Router under `/admin`; Fastify serves `index.html` for `/admin/*`
- [ ] 6.2 Login page with the gyroscope from `public-status-page`, the "run the CLI command" state, logout
- [ ] 6.3 Shared table component with per-column filters and pagination
- [ ] 6.4 Four data pages and the user management page (visible to the superuser only)

## 7. Docs

- [ ] 7.1 `docs/deployment.md`: superuser setup, proxy restriction for `/admin` and `/api/admin`, `TRUST_PROXY`
- [ ] 7.2 `README.md`: admin panel in the features table

```

## docs/openspec/changes/admin-panel/specs/admin-auth/spec.md

- Source: docs/openspec/changes/admin-panel/specs/admin-auth/spec.md
- Lines: 1-70
- SHA256: 41b21c14064aa46cbd6c832682a82bebbdb8d65b424ec6a2a3befd569b8c1a57

```md
## ADDED Requirements

### Requirement: Superuser is set only through the CLI
The service SHALL provide the command `node dist/cli.js superuser set-password [--login <name>] [--password-stdin]`. The default login SHALL be `admin`. Without `--password-stdin`, the command SHALL read the password twice from the TTY with hidden input. The command SHALL NOT accept the password as an argument or an environment variable. If no superuser exists, the command SHALL create it. If a superuser exists, the command SHALL replace its password (and its login if `--login` is given) and SHALL revoke all its sessions.

#### Scenario: First setup
- **WHEN** the operator runs the command in the container and types the same password twice
- **THEN** the server stores the superuser with a hash of the password and prints a confirmation without the password

#### Scenario: Password from stdin
- **WHEN** the operator pipes a password to the command with `--password-stdin`
- **THEN** the command reads one line from stdin and sets the password

#### Scenario: Password change revokes sessions
- **WHEN** a superuser session exists and the operator sets a new password
- **THEN** the old session no longer authenticates any request

#### Scenario: Short or mismatched password
- **WHEN** the password has fewer than 12 characters, or the two prompts differ
- **THEN** the command exits with a non-zero code and changes nothing

### Requirement: Passwords are stored as salted scrypt hashes
The server SHALL hash each admin password with `scrypt` and a random 16-byte salt per password, and SHALL store only the parameters, the salt and the hash. Password comparison SHALL use a constant-time comparison.

#### Scenario: Stored value
- **WHEN** a password is set
- **THEN** the database contains no plain password, and two equal passwords produce different stored values

### Requirement: Admin panel is closed without a superuser
If no superuser exists, the login endpoint SHALL reject every login, and the login page SHALL show that the operator must run the CLI command. The server SHALL NOT create a default password.

#### Scenario: Fresh installation
- **WHEN** no superuser exists and a client sends a login request
- **THEN** the server responds with HTTP 503 and an error that names the CLI command

### Requirement: Login and sessions
`POST /api/admin/login` SHALL accept a login and a password. On success, the server SHALL create a session with a random 32-byte ID, store only a hash of the ID, and set the cookie `b24a_session` with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`. A session SHALL expire 12 hours after login. `POST /api/admin/logout` SHALL delete the session. Every `/api/admin/*` route except login SHALL respond with HTTP 401 without a valid session. A deleted admin user SHALL lose all sessions.

#### Scenario: Successful login
- **WHEN** an active admin user sends the correct login and password
- **THEN** the server responds with HTTP 200 and sets the session cookie

#### Scenario: Wrong password
- **WHEN** the password is wrong or the login does not exist
- **THEN** the server responds with HTTP 401 and the same error for both cases

#### Scenario: Expired session
- **WHEN** a request comes with a session created more than 12 hours ago
- **THEN** the server responds with HTTP 401

### Requirement: Login rate limit
The server SHALL allow at most 5 failed login attempts per client IP address in 15 minutes. Further attempts in that window SHALL get HTTP 429 without a password check.

#### Scenario: Brute force
- **WHEN** a client sends a sixth failed login within 15 minutes
- **THEN** the server responds with HTTP 429

### Requirement: State-changing requests are protected against CSRF
Every state-changing `/api/admin/*` request SHALL require the content type `application/json`. Together with `SameSite=Strict`, this blocks cross-site form posts.

#### Scenario: Cross-site form post
- **WHEN** a request to `POST /api/admin/users` has the content type `application/x-www-form-urlencoded`
- **THEN** the server responds with HTTP 415 and changes nothing

### Requirement: Login events are logged without secrets
The server SHALL log each login success, login failure and logout with the login name and the client IP address. The log SHALL NOT contain passwords, session IDs or cookie values.

#### Scenario: Failed login log
- **WHEN** a login fails
- **THEN** the log line contains the login name and the IP address, and no password

```

## docs/openspec/changes/admin-panel/specs/admin-data-browser/spec.md

- Source: docs/openspec/changes/admin-panel/specs/admin-data-browser/spec.md
- Lines: 1-46
- SHA256: 5c7be95e1350cfcfd52f2ca539915d6f3f249482b042141036195d88ea67bbeb

```md
## ADDED Requirements

### Requirement: Read-only data tables
Every logged-in admin user SHALL see four read-only tables:
- Portals: ID, origin, `client_id`, number of applications, created at.
- Applications: ID, portal origin, `client_id`, title, redirect URI, scope, created at.
- Tokens: ID, portal origin, application title, `client_id`, user ID, scope, created at, access expires at, refresh expires at, state (active or expired).
- Event counters: day, outcome, count.

The admin API SHALL provide only `GET` endpoints for these tables.

#### Scenario: Viewer opens the tokens table
- **WHEN** a viewer opens the tokens table
- **THEN** the table shows token metadata and no edit or delete control

### Requirement: No secrets in admin data
The admin API and UI SHALL NOT return token values, token hashes, secret hashes or any content of the `params` column of token pairs.

#### Scenario: Tokens response
- **WHEN** an admin calls the tokens endpoint
- **THEN** the response contains no `access_hash`, `refresh_hash`, `secret_hash` or `params` field

### Requirement: Search by fields
Each table SHALL accept one filter per column. Text columns SHALL match a case-insensitive substring. Numeric ID columns SHALL match exactly. Date columns SHALL accept a from/to range. The state column of tokens SHALL accept `active` or `expired`. Filters SHALL combine with AND. The server SHALL apply filters in SQL with bound parameters.

#### Scenario: Find tokens of one user on one portal
- **WHEN** an admin filters the tokens table by portal origin `crm.example` and user ID `5`
- **THEN** the table shows only token pairs of user 5 on portals whose origin contains `crm.example`

#### Scenario: Injection attempt
- **WHEN** a filter value contains `' OR 1=1 --`
- **THEN** the server treats it as plain text and returns only matching rows

### Requirement: Visual style of the admin panel
The admin UI SHALL use the same dark theme and design tokens as the status page. It SHALL use subtle animations only (for example, page and row transitions, focus and hover states). When the browser reports `prefers-reduced-motion: reduce`, the admin UI SHALL stop all non-essential animations. The gyroscope animation SHALL NOT appear on data pages; it can appear on the login page.

#### Scenario: Admin opens a data table
- **WHEN** an admin opens the tokens table
- **THEN** the table uses the dark theme, and rows appear with a short fade-in

### Requirement: Pagination
Each table SHALL return at most 50 rows per page and a total count, newest rows first.

#### Scenario: Large table
- **WHEN** the tokens table has 1,000 rows
- **THEN** the first page shows 50 rows and the total 1,000

```

## docs/openspec/changes/admin-panel/specs/admin-users/spec.md

- Source: docs/openspec/changes/admin-panel/specs/admin-users/spec.md
- Lines: 1-33
- SHA256: fe85432395be61c81d08c5fbb84d5ba9e13f0ef75a51422f815f6148eafbbf5a

```md
## ADDED Requirements

### Requirement: Two roles
An admin user SHALL have the role `superuser` or `viewer`. At most one superuser SHALL exist. Only the CLI SHALL create or change the superuser.

#### Scenario: Role of a new user
- **WHEN** the superuser creates an admin user in the panel
- **THEN** the new user has the role `viewer`

### Requirement: Superuser manages viewers
The superuser SHALL list, create and delete `viewer` users, and SHALL set a new password for a viewer. A new password SHALL have at least 12 characters. Delete and password reset SHALL revoke the sessions of that viewer.

#### Scenario: Create a viewer
- **WHEN** the superuser creates a viewer with a unique login and a valid password
- **THEN** the viewer can log in and see the data tables

#### Scenario: Delete a viewer
- **WHEN** the superuser deletes a viewer who has an active session
- **THEN** the next request of that viewer gets HTTP 401

### Requirement: The panel cannot change the superuser
User management endpoints SHALL reject every change to the superuser record with HTTP 403.

#### Scenario: Attempt to delete the superuser
- **WHEN** a request tries to delete or reset the password of the superuser through the panel
- **THEN** the server responds with HTTP 403 and changes nothing

### Requirement: Viewers cannot manage users
User management endpoints SHALL respond with HTTP 403 to a viewer.

#### Scenario: Viewer tries to create a user
- **WHEN** a viewer sends `POST /api/admin/users`
- **THEN** the server responds with HTTP 403

```
