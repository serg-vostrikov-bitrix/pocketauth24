# Security review: claude/readme-human-language-5c6526

Date: 2026-11-19
Scope: `git diff origin/main...HEAD` (README.md and README.de/it/es/pt/ru.md, docs only)

## Result

No findings.

## What was checked

1. **Secrets.** The added lines contain no real credentials, keys, tokens or private-key blocks. `POSTGRES_PASSWORD` shows only the placeholder `<password>`.
2. **Reverse proxy rule.** All six files keep the same meaning: deny by default, allow all paths only from the portal server IP addresses, exempt only `/oauth/token`, `/health` and, optionally, the status page. Paths must match with and without the trailing slash.
3. **Registration and admin panel.** The warning that anyone who reaches `/oauth/register/` with an allowlisted address can rotate the portal credentials is still present, with the order to limit the path by IP. The order to limit `/admin` and `/api/admin` at the proxy is still present.
4. **Allowlist and `TRUST_PROXY`.** The `PORTAL_ALLOWLIST` and `TRUST_PROXY` guidance did not change in meaning.
5. **Links.** The diff adds no new link targets.
