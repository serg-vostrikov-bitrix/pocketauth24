# Review

Verdict: pass with changes

Artifact Type: final claim review (GitHub README, `README.md`). Evidence: `01-user-manual.en.md` (with the coordinator corrections: 55 tests, MIT in LICENSE and package.json) and `02-positioning-brief.en.md` (`Do Not Claim` list applied).

## Blocking Issues

None. No README line contradicts the `Do Not Claim` list. Checked and found supported:

- No marketplace-app, published-image, CD, production, HA, retry, licence-check, full-OAuth, admin-UI or vendor-affiliation claim. Each of these appears only as a limit or non-claim (lines 82, 144-153, 167, 195-197).
- The "independent, not a Bitrix24 product" statement is at line 20 and again at line 197.
- Badges:
  - Tests: 55 passing, confirmed by the coordinator.
  - Contract-tested: supported by the manual.
  - Closed network: "verified on test portal", supported (10 of 10 steps).
  - Dependabot: `.github/dependabot.yml` has npm, github-actions and docker.
  - MIT: LICENSE and package.json agree.
  - Node 24: `engines` is `>=24`.
  - TypeScript strict: `tsconfig.json` sets `strict: true`.
  - Fastify 5: `^5.12.8`.
  - PostgreSQL 17 and Docker compose: both supported.
  - CI: the URL matches the repository in package.json and `ci.yml` exists.
- Relative links all resolve: `LICENSE`, `docs/deployment.md`, `docs/e2e-checklist.md`, `docs/protocol-capture.md`, `docs/research/2026-11-18-oauth-server-analysis.md`, `docs/launchkit/01-user-manual.en.md`, `.github/workflows/ci.yml`, `.env.example`.
- The mermaid sequence diagram (lines 51-69) is syntactically valid.
- The npm scripts at line 187 exist.
- The `.env.example` variables match line 189.

## Important Improvements

- Line 71, "All traffic stays inside your network.": this is an unqualified absolute that neither the manual nor the brief makes. README line 137 says apps usually load `BX24` from `//api.bitrix24.com`, and line 127 says apps may call the cloud token URL. The manual supports only that OAuth calls reach this server (the earlier internet-open run showed every OAuth call hitting it). Fix: "OAuth traffic between the portal, local applications and the server stays inside your network." Alternatively, delete the sentence and keep the proxy sentence.
- Line 32, "**Smaller blast radius.**": this is a broad security-outcome claim. The brief supports only "limits the impact of a database or log leak", and line 146 admits that registration can be abused without proxy IP restriction. Fix: "**Limits the impact of a database or log leak.** Tokens and secrets are stored only as hashes, and query strings never reach the logs."

## Optional Polish

- Line 33, "One server, several portals": the manual states it, but the end-to-end run used a single test portal. Optionally add "(portal data is scoped per portal; end-to-end verified with one portal)". Not required.

## Stop Condition

Fix the two Important items (lines 71 and 32) and stop. No further review pass is needed.
