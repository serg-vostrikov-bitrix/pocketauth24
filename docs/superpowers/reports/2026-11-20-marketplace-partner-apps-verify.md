# Verification report: marketplace-partner-apps

Date: 2026-11-20. Mode: full (`comet state scale`: 19 tasks, 3 delta specs, 54 changed files).
Range: `e9e5c82..HEAD` on `claude/partner-apps-service-integration-fa778c`.

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | 19/19 tasks done; 9 requirements in 3 delta specs implemented |
| Correctness | 17/17 scenarios covered by tests; live portal run passed |
| Coherence | Design D1-D6 and the Design Doc followed; one recorded deviation (see below) |

Result: **PASS**. No CRITICAL or IMPORTANT issues.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Lint | Pass | `npm run lint` exit 0 (eslint and prettier) |
| Type check | Pass | `npm run typecheck` exit 0 |
| Build | Pass | `npm run build` exit 0; recorded with `comet state record-check` |
| Tests | Pass | `npm test`: 198/198 at `b1acd1a`. Later commits change docs only |
| Contract tests | Pass | `test/contract/cloud-shapes.test.ts` unchanged and green |
| Live portal | Pass | `docs/e2e-checklist.md`, "Run 2026-11-20 (Marketplace application of a partner)" |
| Security | Pass | Secrets stored as sha256 only; CLI reads the secret from stdin or a hidden prompt; no secret, hash or token in logs, CLI output or admin data |

## Scenario coverage

| Spec | Scenario | Test |
| --- | --- | --- |
| marketplace-catalog | Entry serves all portals | `application-registry.test.ts` "Entry serves all portals" |
| marketplace-catalog | Add an entry | `admin-cli.test.ts` "marketplace add stores only the hash of the secret" |
| marketplace-catalog | Rotate the secret | `token-service.test.ts` "Rotate the secret" |
| marketplace-catalog | Remove an entry | `marketplace-catalog.test.ts` "Remove an entry" (cascade to installs and tokens) |
| marketplace-catalog | Database leak | `admin-cli.test.ts` hash check; `admin-data.test.ts` no hash in admin data |
| application-registry | Install from the Marketplace | "Install from the Marketplace"; live run |
| application-registry | Repeated install | "Repeated install" (same row id, token still valid) |
| application-registry | Application of another vendor | "Application of another vendor" (text and `request_failed` reason) |
| application-registry | Subscription install | "Subscription install" |
| application-registry | Uninstall removes tokens | "Uninstall removes tokens"; live run |
| application-registry | Scope update, Delete removes tokens | Existing tests, unchanged |
| application-registry | Foreign application | Update/delete on an install row gives `Application not found` |
| application-registry | Status sync | Existing `application.list` test |
| token-service | Fields present | Existing test, unchanged |
| token-service | Status of a Marketplace application | "Status of a Marketplace application"; "Install event reaches a Marketplace install" |
| token-service | Partner backend renews a token | "Partner backend renews a token" (status F, cross-portal check) |

## Design adherence

- D1 (catalog table plus install rows), D2 (status from the row kind), D3 (idempotent install and
  uninstall), D4 (renewal checks the catalog secret), D5 (CLI) and D6 (errors through `fail()` with
  reasons) are implemented as written. The migration matches the Migration Plan.
- Deviation, accepted during Build: `marketplace add` refuses a `client_id` that starts with
  `local.`. The open-phase review removed this check, and the design review then removed the
  install-time guard. The CLI check is the one line that keeps a local row safe from an operator
  typo. The delta spec does not forbid it.

## Reviews

- Per-task independent reviews for the risk tasks 1, 3, 4, 5, 6 and 7: all approved.
- Final integration review of the whole branch (`e9e5c82..b1acd1a`): "Ready to merge". It covered
  portal scoping of every `client_id` lookup, the install upsert, renewal across portals, cascades
  and secret leaks.

## Accepted minor findings (follow-ups, not blocking)

1. An install that races `marketplace remove` returns HTTP 500 instead of `ERROR_OAUTH`.
2. The admin and status views do not tell an install from a local application.
3. `marketplace add` does not check the `client_id` format.
4. CLI refusal tests assert only the exit code and the missing row, not the stderr text.
5. `hashPassword` in `setPassword` runs outside the safe error wrapper.
6. A scope that normalizes to an empty string is accepted.

## Not checked

- The app page of a real partner in a browser, with the partner backend renewing at
  `server_endpoint`. The test app belongs to another vendor, whose backend uses the cloud.
