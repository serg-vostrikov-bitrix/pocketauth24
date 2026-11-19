# Brainstorm Summary

- Change: admin-panel
- Date: 2026-11-18
- Status: confirmed by the user

## Confirmed Technical Approach

- User decisions: the server generates viewer passwords (20 random characters, shown once); layout = left sidebar + table with one filter under every column header, 300 ms debounce, filters in the URL.
- Tables `admin_users` (login, password_hash, role superuser|viewer, created_at; partial unique index on role = 'superuser') and `admin_sessions` (id_hash, user_id FK ON DELETE CASCADE, expires_at).
- scrypt N=2^15 r=8 p=1 with random salt; dummy-hash verification for unknown logins.
- CLI `dist/cli.js superuser set-password`: hidden TTY input twice or `--password-stdin`; needs only DATABASE_URL; runs migrations first.
- API `/api/admin/*`: login, logout, me; users (superuser only); 4 read-only data endpoints with `filter[column]` whitelist, 50 rows per page plus total; JSON-only guard (415) on writes; in-memory rate limit 5 failures / 15 min per IP; hourly cleanup deletes expired sessions; `TRUST_PROXY` env.
- Fastify serves `index.html` for `/admin/*`.
- Frontend: admin code lazy-loaded in the same bundle; React Router; one shared DataTable component; login page with gyroscope and the CLI hint when no superuser exists; Users menu only for the superuser.

## Key Trade-offs and Risks

- In-memory rate limit resets on restart; one instance only.
- `ILIKE` substring search without trigram indexes; fine at tens of thousands of rows.

## Testing Strategy

- Integration tests with real PostgreSQL: password helpers; CLI spawned with `--password-stdin`; auth (success, same error for wrong password and unknown login, 503, 429, cookie flags, expiry, 415, no password in logs); users (permissions, 403 cases, session revocation); data (no secret fields, filters, injection, pagination, 401).
- Manual browser check for the UI; manual check of the hidden TTY prompt.

## Spec Patches

None written back. The Comet runtime freezes the delta specs after the design handoff. The two clarifications below do not contradict the frozen text and are recorded in Design Doc section 9:

- admin-users: on create and on password reset, the server generates a random 20-character password and returns it once (satisfies "a new password SHALL have at least 12 characters").
- admin-data-browser: token state (`active`/`expired`) uses the access token expiry (the spec leaves the rule open).
