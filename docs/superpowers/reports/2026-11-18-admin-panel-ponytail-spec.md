# Ponytail review of open-phase artifacts: admin-panel, public-status-page

Date: 2026-11-18

| # | Location | Finding | Result |
|---|---|---|---|
| 1 | admin-users spec | delete: "change own password" for viewers. Nobody asked; the superuser resets passwords. | Cut |
| 2 | admin-users spec | yagni: disable/enable of viewers in addition to delete. Delete plus re-create covers it. | Cut, `disabled_at` column removed |
| 3 | admin-auth spec, design D3 | shrink: idle timeout plus absolute timeout with throttled `last_seen_at` writes. A fixed 12-hour lifetime is enough. | Cut idle timeout and `last_seen_at` |
| 4 | admin-data-browser spec, design D7 | yagni: client-selected sort on every column. The user asked for search, not sort. | Cut, fixed newest-first order |
| 5 | service-status spec | delete: uptime in `/api/status`. Not asked. | Cut |
| 6 | admin-auth spec | `--login` CLI flag | Kept: one flag, lets the operator choose a non-default login |
| 7 | admin-data-browser spec | date range filters | Kept: dates are table fields and the user asked for search by fields |
| 8 | design D5 | `TRUST_PROXY` variable | Kept: without it the rate limit sees only the proxy IP |
| 9 | design D3 public | 10-second stats cache | Kept: the endpoint is public and unauthenticated |

net: about -25 lines of spec, 2 columns, 1 endpoint group removed.

## Addendum: visual style (user request at final review)

| # | Location | Finding | Result |
|---|---|---|---|
| 10 | service-status spec, design D2b | Gyroscope with WebGL library would add about 150 KB | Rejected in design: CSS 3D transforms only |
| 11 | both changes | Reduced-motion support | Kept: one media query, required for accessibility |
