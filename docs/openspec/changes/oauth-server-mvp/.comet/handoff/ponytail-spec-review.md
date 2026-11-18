# Ponytail review: oauth-server-mvp OpenSpec artifacts

Date: 2026-11-18. Run late (during the design phase, before the Design Doc), because the
open-phase review was missed. The usual location `docs/superpowers/reports/` is reserved for
the verify-phase report by the Comet guard, so the report lives here.
Scope: proposal.md, design.md, tasks.md, specs/*/spec.md.

## Findings

1. `application-registry` "Install and uninstall": **delete**. The portal never calls
   `application.install` / `application.uninstall` for local apps (`AppTable::uninstall`
   skips status `L`; install is called only from the marketplace flow). Removed the
   requirement, its two scenarios, task 4.3 and the `installed` / `version` columns.
   Unimplemented methods fall to `ERROR_METHOD_NOT_FOUND`.
2. `token-service` revocation path (`revoked_at`, "revoked" in two scenarios): **delete**.
   Its only trigger was uninstall (finding 1). Deleting an app cascades its tokens, and the
   portal blocks uninstalled local apps itself. Scenarios now say "unknown or foreign".
3. `token-service` "both configurable" token lifetimes: **yagni**. Fixed at 3600 s and
   180 days (6 months), as in the cloud; apps may assume these values. Removed from config.
4. `portal-registration` "Portal member identifier" requirement: **shrink**. A one-line
   md5; folded into the token response format requirement and its scenario.
5. tasks 2.2 "repositories": **yagni**. The design has no repository layer; portal scoping
   moved into task 2.1. Task 3.3 folded into 3.2.
6. design.md open question "several server instances": **delete**. Speculative; the
   migrations-on-boot ceiling already records the single-instance assumption.
7. Stale wording fixed: "installations" storage, "rotation", "used flags", "worker pool".

## Kept on purpose

- "Foreign application" and "foreign token" scenarios: trust boundary between portals.
- "Token storage safety": security requirement.
- "No retries in this stage" + "Overload": they define what tests check, not extra code.
- `application.list` returning `[]`: the portal calls it for status sync.

net: about -30 lines of spec, one requirement, one task, three columns.
