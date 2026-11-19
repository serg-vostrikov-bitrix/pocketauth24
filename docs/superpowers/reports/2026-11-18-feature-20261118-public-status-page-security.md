# Security review: feature/20261118/public-status-page

Date: 2026-11-18. Scope: diff of `feature/20261118/public-status-page` against `origin/main` (before the merge of `main` into the branch). Method: `security-review` skill, confidence threshold 8.

## Result

No findings.

## What was checked

- `GET /api/status`: returns only the version and aggregate counts. No hosts, `client_id` values, tokens or secrets. Query errors go to the server log only.
- SQL injection: `recordOutcome` uses Drizzle bindings; `outcome` is a code literal limited by a CHECK constraint; `n` is server-computed. Statistics queries take no request input.
- Static serving: fixed root from `import.meta.url`; `wildcard: false` registers only files found at boot; `index: false`; without a build, `/` stays the JSON 404. No path traversal.
- CSP: `default-src 'self'` and `frame-ancestors 'none'` on `index.html`; no inline script. `style-src 'unsafe-inline'` is a hardening gap, not a vulnerability.
- XSS in `web/src`: no `dangerouslySetInnerHTML`, `innerHTML` or `eval`.
- Docker image: runs as `USER node`; dev dependencies pruned; no `web/node_modules`; no secrets.
- Dependencies: `@fastify/static`, React, Vite and TypeScript are standard; Dependabot watches `web/`.
- CI: build steps only, no untrusted input.

Out of scope by the skill rules: DoS through `/health` probes or counter upserts. Mitigations exist: 10-second status cache, one upsert per batch for dropped events.
