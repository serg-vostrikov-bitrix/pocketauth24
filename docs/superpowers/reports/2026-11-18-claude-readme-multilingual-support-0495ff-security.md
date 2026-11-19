# Security review: readme multilingual support

Branch: `claude/readme-multilingual-support-0495ff`
Date: 2026-11-18
Scope: `git diff origin/main...HEAD` (documentation only)

## Result

No findings.

## What the review checked

- The set of URLs is the same in all six README files. All hosts are the project repository, shields.io badges or the existing example hosts.
- The language switcher uses relative links only.
- Every translation keeps the security guidance: the loopback binding `127.0.0.1:3000`, the `PORTAL_ALLOWLIST`, the warning that the proxy controls `/oauth/register/`, hashed storage of tokens and secrets, and log redaction.
- No secrets in the changes.

## Limits of the review

- The reviewer did not compare the code blocks of the Italian, Spanish and Portuguese files line by line.
- The reviewer did not read the full translated text. Native speakers did not review the translations.
