# Design review: token-pair-pruning

Date: 2026-11-19. Scope: docs/superpowers/specs/2026-11-19-token-pair-pruning-design.md.
(The phase guard blocks `docs/superpowers/reports/` before verify, so the report is here.)

## Ponytail

| Finding | Action |
|---|---|
| Transaction around insert and `DELETE` | Kept. Two statements; one `db.transaction` call. Without it, a failed `DELETE` leaves an issued pair after an error response. |
| `startApp` `config` option | Kept. Test support only, no production seam. |
| Nothing else to cut | Lean already. |

## Test audit

| Finding | Action |
|---|---|
| "Pruning off" test could pass when nothing is old enough to delete (negative control that passes for an unrelated reason) | Changed: it uses the setup that deletes with pruning on. |
| "Other users and applications" test could pass when they have too few pairs | Changed: each has more than 5 expired pairs. |
| One test per invalid value duplicates one contract | Changed: one `it.each` table per variable. |
| Config parsing unit tests | Kept: config contract (retention bar). |
| Every spec scenario has a test | Checked: 5 of 5 covered. |
