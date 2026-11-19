# Security review: claude/pocketauth24-issue-28-da6669

Date: 2026-11-19. Scope: diff against `origin/main` (src, test, drizzle; docs skimmed for secrets).
Method: `security-review` skill in a separate agent.

**Result: No findings.**

| Area | Result |
|---|---|
| SQL injection | None. The prune `DELETE`, its subquery and the `coalesce(...)` `UPDATE` use Drizzle builders and bound parameters; the timestamp comes from the server clock. Migration 0003 is static DDL. |
| Tenant scoping of the `DELETE` | Limited to `application_id`, `user_id`, `refreshed_at is not null` and an expired access token. On refresh, the application passed the `client_id` / `client_secret` check first. |
| Token handling | Pruned pairs only had an already-used refresh token. A pruned refresh token gets `invalid_grant`. Tokens stay hashed and are not logged. |
| Config and query cost | `TOKEN_PRUNING_KEEP` must be a positive safe integer; the partial index matches the prune predicate. |
| Race conditions | The row lock from `UPDATE ... RETURNING` serializes refreshes of one pair; a prune/refresh race fails closed. |
| Secrets in diff | Only placeholders and example hosts. |

The review ran after the PR was opened; the PR body links this report.
