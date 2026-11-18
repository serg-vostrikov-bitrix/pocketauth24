# Security review: feature/20261118/oauth-server-mvp

Date: 2026-11-18. Scope: `git diff origin/main...HEAD` (all of `src/`, Dockerfile, compose, CI,
`.env.example`, schema and migrations, deployment guide, HAR fixtures). Run with the
`security-review` skill after PR #1 was opened.

## Findings

### 1. Trailing slash bypassed the documented proxy restriction on `/oauth/register/` — High, fixed

- `src/app.ts:29` sets `ignoreTrailingSlash: true`, so `POST /oauth/register` reaches the
  registration handler. `docs/deployment.md` section 4 only named `/oauth/register/`. A proxy
  rule written literally for that path let `/oauth/register` through, re-opening the known
  unauthenticated re-registration (portal lock-out and credential takeover).
- Fix: section 4 now says deny by default, allow only `/oauth/token` and `/health` from
  application servers, match both slash forms, with an nginx example. Regression test
  `test/integration/routing.test.ts` "Registration without a trailing slash reaches the same
  handler" pins that both spellings exist.
- Still open (known risk): the server itself has no registration secret or lock; the proxy rule
  remains the only control. A registration lock is a candidate for the next stage.

## Below threshold (not fixed, recorded)

- SSRF through event handler URLs (`src/methods/events.ts`): blind POST from an authenticated
  portal, no redirects, same as the cloud. Consider a handler host allowlist if the server sits
  in a zone the portal cannot reach.
- `docker-compose.yml` falls back to a known Postgres password when `POSTGRES_PASSWORD` is unset;
  the port is bound to loopback.
- Request bodies up to 10 MB are parsed before service authentication; covered by the proxy ACL
  and `client_max_body_size`.
- CI: reusable workflow and actions are not pinned to SHAs; no `permissions:` block.

## Reviewed, no issue

Cross-portal isolation, secret generation and constant-time comparison, log redaction, injection,
container image (non-root, no secrets in layers, loopback publish), HAR fixtures (all secrets
redacted, no cookies or auth headers).
