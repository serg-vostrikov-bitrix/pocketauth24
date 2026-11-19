# Security review: claude/refresh-token-compression-994321

Date: 2026-11-19
Scope: `git diff origin/main...HEAD`, one new file:
`docs/research/2026-11-19-sealed-refresh-tokens.md` (design analysis, no code).
Method: `security-review` skill. A subagent did the review. The rule that excludes documentation
was set aside, because the design itself is the subject. Each finding was checked against
`src/tokens.ts`.

## Leaked secrets or real tokens

None. The document contains no keys, no real tokens and no credentials.

## Findings

| # | Severity | Section | Issue | Resolution |
| --- | --- | --- | --- | --- |
| 1 | Medium | 3.2, 3.5 | A sealed refresh token cannot be revoked alone. Today one row can be deleted. | Fixed in the doc: `grants.revoked_before`, checked against `iat`; note that pruning no longer limits live refresh tokens. |
| 2 | Medium | 3.2 step 4 | The sealed path did not state that the application comes from the grant. A lookup by the presented `client_id` would let app B refresh app A's token. | Fixed in the doc: load the application through `grant.application_id`, compare `client_id`, negative test; keep the portal filter in `rest.check`. |
| 3 | Low | 3.4 | One key for the MAC and the fingerprint; old keys not specified; no rule for a compromised key. | Fixed in the doc: HKDF subkeys, `TOKEN_KEYS` keyring with a fingerprint per `key_id`, immediate removal of a compromised key. |
| 4 | Low | 3.2 | MAC details not fixed: comparison, binary layout, unknown `key_id`, 4-byte `grant_id` against `bigserial`. | Fixed in the doc: `timingSafeEqual`, fixed big-endian layout, unknown `key_id` goes to the legacy lookup, refuse `id > 2^32 - 1`. |
| 5 | Low | 4 | Fallback-issued sealed tokens live 180 days and ignore upstream revocation after recovery. | Fixed in the doc: version bit and short TTL; reject or exchange once after recovery. |

## Result

Five findings, all in the proposed design. All five are fixed in the document. No code is
affected, because the branch has no code changes.
