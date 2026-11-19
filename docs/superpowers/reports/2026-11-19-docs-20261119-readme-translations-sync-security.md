# Security review: readme translations sync

Branch: `docs/20261119/readme-translations-sync`
Date: 2026-11-19
Scope: `git diff origin/main...HEAD` (documentation only)

## Result

No findings.

## What the review checked

- The change adds no new URLs. The only changed URL is the value of the shields.io test badge (69 to 153).
- Each translation now has the `TRUST_PROXY` row. The row keeps the warning: set `true` only when the proxy overwrites `X-Forwarded-For` with the client IP (`$remote_addr`, not `$proxy_add_x_forwarded_for`).
- Each translation now tells the operator to restrict `/admin` and `/api/admin` at the proxy. It also states that the admin panel has no SSO, no two-factor authentication and no audit log.
- The admin panel row states that the panel shows token metadata only, not tokens or hashes.
- No secrets in the changes.

## Limits of the review

- The English `README.md` gets these statements from PR #18. Merge this change after PR #18, or the translations describe an admin panel that `main` does not have.
- Native speakers did not review the translations.
