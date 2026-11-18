# Design review: oauth-server-mvp Design Doc

Date: 2026-11-18. Target: `docs/superpowers/specs/2026-11-18-oauth-server-mvp-design.md`.
The usual location `docs/superpowers/reports/` is reserved for the verify-phase report by the
Comet guard, so the report lives in the change handoff folder.

## Ponytail

1. `EVENT_TIMEOUT_MS`, `EVENT_MAX_IN_FLIGHT`, `LOG_LEVEL` env vars: **yagni**. Constants 10 s, 200, `info`. Changed.
2. `portals.license` jsonb: **delete**. Nobody reads it before stage 2; licence fields ignored. Changed, plus a one-line spec patch in `portal-registration` ("stored" → "ignored").
3. `updated_at` columns: **delete**. Nobody reads them. Changed.
4. Separate "Events" test row: **shrink**. Merged into integration. Changed.
5. Kept: `index (refresh_expires_at)` (one line, serves the hourly cleanup); NTC `ci-security.yml` (organisation requirement).

## Test audit

1. Unit "token response": **duplicate** of the integration scenario "Fields present". Removed.
2. Unit "`local.*` format": **duplicate** of "Portal creates a local app". Removed.
3. Unit "event `auth` block": **duplicate** of the two event-auth integration scenarios. Removed.
4. Unit "qs parsing of deep PHP forms": **tests the library**. Replaced by one integration case with `data` nested deeper than 5 levels.
5. Contract tests: expected values must come from cloud HAR, not from our serializer; replaying raw cloud requests cannot work (their tokens do not exist in our DB). Reworded: drive our server through the flow, compare shapes with HAR. Changed.
6. Missing owner for time-based scenarios: added fake timers and the rule that expiry is compared in app code.
7. Missing owner for "Install URL of a local app still runs": no meaningful server test beyond "usable immediately"; owned by the end-to-end check 7.2. Recorded.
8. Kept: one table-driven unit test for scope intersection (cheaper than HTTP for edge cases with no spec scenario of their own).

## Handoff regeneration workaround (owner-approved)

Spec Patches made after the first design handoff left `handoff_hash` stale, and
`comet handoff --write` refused with "stale handoff detected"; `handoff_hash` cannot be set to
null. With the owner's approval: `comet state set oauth-server-mvp handoff_hash <current
--hash-only value>`, deleted the generated `design-context.md`, re-ran `comet handoff ... design
--write`; the design guard then passed. Old hash 3a1f87ba…, new hash 551fc884….
