# Security review: claude/events-resource-issues-add11a

- Date: 2026-11-18
- Scope: `git diff origin/main...HEAD` (per-host cap for event delivery, README and docs, tests)
- Method: `security-review` skill, run by a subagent on the branch diff

## Result

No findings with a confidence of 8 or higher.

## What was checked

- **Counter leaks on exceptions** (`src/methods/events.ts`): the cap check and both increments run synchronously, with no `await` between them. The `finally` block always decrements both counters, so a `buildAuth`, `fetch` or timeout error cannot leak a slot.
- **Map growth**: the `finally` block deletes a host key when its count is 0. The map holds only hosts with deliveries in flight (at most 200 keys). All invalid URLs share one `'<invalid url>'` key.
- **Credential leakage**: the host key is `new URL(raw).host` (host and port only). The code does not log the key. The drop log adds only the constant field `limit`.
- **Log injection**: no new data from the caller reaches the logs.
- **SSRF and authorization**: the outgoing request and the access rules for `rest.event.call` do not change.

## Accepted behaviour

A caller can fill the 100 slots of one handler host, and all invalid URLs share one bucket. This is the intended behaviour of the cap, not a vulnerability.
