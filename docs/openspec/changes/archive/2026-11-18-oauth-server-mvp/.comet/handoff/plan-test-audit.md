# Plan test audit: oauth-server-mvp

Date: 2026-11-18. Target: docs/superpowers/plans/2026-11-18-oauth-server-mvp.md. Run by the
planning subagent (ntc-test-audit). `docs/superpowers/reports/` is reserved for the verify report
by the Comet guard, so the report lives here.

## Fixed in the plan

1. "Database leak" no longer compares stored hashes with `sha256()` from the code under test.
2. "Unknown or foreign token" first proves the token is valid on its own portal (negative control).
3. "Delete removes tokens" first proves the token works before the delete.

## Kept, with reasons

- "Usable immediately" near-duplicate of "add": distinct spec scenario, cheap.
- `application.list` called twice, direct DB insert in one setup, health test, 300 ms no-retry
  wait, overload test (undici connection flake risk noted), scope table, contract suite.

## Design deviation recorded

Refresh grant looks up the token pair first: unknown token or token of a deleted app →
`invalid_grant`; mismatching client id/secret → `invalid_client` (required by spec scenarios;
refines Design Doc 5.3 order).
