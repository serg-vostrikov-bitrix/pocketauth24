# Security review: feature/20261118/admin-panel

Date: 2026-11-19. Scope: `git diff origin/main...HEAD`, without lockfiles, Drizzle snapshots, `docs/openspec` and `docs/superpowers`. Method: `security-review` skill.

## Result

No findings.

## What was checked

- **Unauthenticated access:** every admin route except `/login` is in a scope with an `onRequest` session check that runs before body parsing. Unknown admin paths get a JSON 404; admin responses have `no-store`.
- **Sessions:** 32 random bytes; only the SHA-256 is stored; cookie `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`. Logout, password reset, a new superuser password and viewer deletion end the sessions.
- **Roles:** user management needs the superuser role; reset and delete lock the target row and refuse the superuser with 403; the database allows one superuser.
- **CSRF:** writes need `application/json`; no CORS; `SameSite=Strict`.
- **SQL injection:** fixed column lists, bound parameters, escaped LIKE wildcards, strict id/enum/date/page checks.
- **Information disclosure:** explicit select lists without hash or `params` columns; generic 500 body; no query strings in request logs; generated passwords only in create/reset responses; the CLI prints only the database cause message.
- **Login timing:** dummy scrypt hash for unknown logins; `timingSafeEqual`.
- **Rate limit:** the attempt is reserved before the password check; `TRUST_PROXY` is an operator setting and the docs require the proxy to overwrite `X-Forwarded-For`.
- **XSS:** no `dangerouslySetInnerHTML` or `innerHTML`; CSP `default-src 'self'`, `frame-ancestors 'none'`.
- **CLI password:** hidden TTY input or `--password-stdin`; never an argument; never printed.
