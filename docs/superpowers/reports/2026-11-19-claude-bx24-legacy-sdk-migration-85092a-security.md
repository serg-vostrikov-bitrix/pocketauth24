# Security review — claude/bx24-legacy-sdk-migration-85092a

Date: 2026-11-19

## Scope

The diff against `origin/main` changes documentation only:

- `README.md` and the five translations: one sentence in the `BX24` item.
- `docs/deployment.md`, section 7a: one new item.
- `docs/launchkit/01-user-manual.en.md`: one new item.

No code, configuration, dependency or CI file changes.

## Checks

- The only new link is `https://github.com/bitrix24/b24jssdk`, the official Bitrix24 organization on GitHub. It is HTTPS.
- The diff adds no secrets, tokens, host names of internal systems or personal data.
- The advice to serve `BX24` from an internal host does not change. The diff only limits it to existing apps.

## Result

No findings.
