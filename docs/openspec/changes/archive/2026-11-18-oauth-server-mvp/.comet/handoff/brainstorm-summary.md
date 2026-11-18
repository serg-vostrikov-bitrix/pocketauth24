# Brainstorm Summary

- Change: oauth-server-mvp
- Date: 2026-11-18

## Confirmed Technical Approach

- Standalone Node.js LTS + TypeScript (strict, ESM) service on Fastify, PostgreSQL via Drizzle, Vitest.
  NTC policy defaults new projects to .NET; the owner chose Node.js with a CTO-approved exception,
  to be recorded before implementation starts.
- Modular monolith of ~12 files (reviewed with ponytail): app.ts, server.ts, config.ts, db.ts,
  schema.ts, drizzle/ migrations, bitrix.ts (response shapes), tokens.ts (shared issue/refresh/check),
  routes/{register,rpc,oauthToken}.ts, methods/{applications,tokens,events}.ts. Method registry is a
  plain object; portal auth is a preHandler; forms parsed by @fastify/formbody + qs.
- Data: portals, applications, token_pairs (hashed access/refresh, user_id, scope, params jsonb,
  expiries). No install/uninstall support and no revocation column: the portal never calls
  install/uninstall for local apps (ponytail review, see ponytail-spec-review.md); delete cascades.
- Token lifetimes fixed at 3600 s / 180 days (6 months) as in the cloud (not configurable).
- Refresh tokens are reusable until their own expiry; each refresh issues a new pair (owner's field
  knowledge of cloud behaviour, contrary to docs; verified in task 1.1).
- Event delivery: fire-and-forget fetch with 10 s timeout and an in-flight cap (200); overflow and
  failures are logged and dropped.
- Protocol capture with mitmdump in reverse mode exporting HAR; no custom recorder.
- Local app is treated as installed on add; required for the URL_INSTALL page to get tokens.

## Key Trade-offs and Risks

- Node.js instead of .NET needs a CTO exception (policy risk).
- Response formats inferred from box sources until HAR capture; all shapes live in bitrix.ts.
- Reusable refresh tokens are less strict than single-use, chosen for compatibility.
- Events are lost on restart, handler outage or overload (stage 3 adds a persistent queue).
- Migrations on boot are safe for one instance only.
- Deviations from NTC standards: Bitrix error shape instead of RFC 7807, Bitrix client credentials
  instead of 24IdP JWT, flatter structure than the NTC sample layout.

## Testing Strategy

- Unit: token logic, scope intersection, client_id format, event auth block, PHP form parsing.
- Integration: Fastify inject() against real PostgreSQL (CI service container, local compose),
  TRUNCATE between files, every spec scenario covered.
- Contract: replay portal requests from HAR fixtures, compare response shape and error codes.
- Event delivery: local node:http handler in tests (body, timeout, overload).
- Manual end-to-end checklist on the test portal without internet (task 7.2).

## Spec Patches

- token-service: refresh token reusable until expiry (replaces the single-use requirement and its
  reuse scenario).
- event-delivery: overload scenario (over the in-flight cap the event is logged and dropped).
- tasks.md 1.1: capture with mitmdump and explicitly test double refresh with one refresh token.
- Ponytail cuts: removed install/uninstall requirement, revocation path, configurable TTLs,
  separate member_id requirement (folded into token response format).
