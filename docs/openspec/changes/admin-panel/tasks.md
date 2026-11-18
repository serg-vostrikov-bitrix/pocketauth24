## 1. Data and password primitives

- [x] 1.1 Add `admin_users` and `admin_sessions` to `src/schema.ts`; generate the migration with the partial unique index for the superuser
- [x] 1.2 `src/admin/password.ts`: scrypt hash and verify with `timingSafeEqual`; unit tests

## 2. CLI

- [x] 2.1 `src/cli.ts` with `superuser set-password`: hidden TTY prompt twice, `--password-stdin`, `--login`, length check
- [x] 2.2 Create or update the superuser and revoke its sessions; integration tests

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
