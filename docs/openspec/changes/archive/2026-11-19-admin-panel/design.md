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
