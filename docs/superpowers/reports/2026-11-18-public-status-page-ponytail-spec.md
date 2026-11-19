# Ponytail review of open-phase artifacts: public-status-page

Date: 2026-11-18. The joint review of both changes of batch `service-ui-admin-panel` is in `2026-11-18-admin-panel-ponytail-spec.md`.

| # | Location | Finding | Result |
|---|---|---|---|
| 1 | service-status spec | delete: uptime in `/api/status`. Not asked. | Cut |
| 2 | design D3 | 10-second stats cache | Kept: the endpoint is public and unauthenticated |
| 3 | event-delivery spec | `dropped` outcome in addition to delivered and failed | Kept: one line, shows overload that is otherwise only in logs |
| 4 | design D2b | Gyroscope with a WebGL library would add about 150 KB | Rejected: CSS 3D transforms only |
| 5 | service-status spec | Reduced-motion support | Kept: one media query, required for accessibility |
| 6 | service-status spec | "Status with a healthy database" and "Database is available" scenarios | Kept: they test two different endpoints |

net: about -1 line of spec; no further cuts.
