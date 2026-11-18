# Security review: docs/20261118/selling-readme

Date: 2026-11-18. Scope: staged diff vs `main` — README rewrite, `docs/deployment.md`
(`BITRIX_OAUTH_URL` placement), new `docs/launchkit/*.md`, `package.json` license ISC → MIT.
Run with the `security-review` skill.

## Findings

No findings.

- No secrets, tokens, internal host names, local paths or personal data; examples use
  placeholders (`auth.corp.local`, `<password>`).
- Security guidance is consistent with the code and `docker-compose.yml`: deny-by-default proxy
  with `/oauth/token` and `/health` as exceptions and both slash forms matched; registration
  protected only by proxy IP restriction (stated plainly); TLS at the proxy; app port on
  loopback.
- `BITRIX_OAUTH_URL` now goes to `local/php_interface/init.php` instead of editing `dbconn.php`,
  with a note that the constant overrides the `oauth_server` option.
- Security claims are not overstated (not production-proven, inferred status codes listed).
