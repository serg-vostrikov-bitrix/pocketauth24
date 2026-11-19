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
