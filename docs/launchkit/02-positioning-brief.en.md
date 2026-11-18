# Positioning brief

Channel: the GitHub README of a self-hosted, MIT-licensed server. This is not a marketplace listing. Source of facts: `01-user-manual.en.md`, with two coordinator corrections (55 automated tests confirmed passing; `package.json` license is MIT, matching `LICENSE`).

## Target audience

Organisations that run Bitrix24 on-premise in a network with no internet access, or where outbound access from the portal is blocked by policy: closed corporate networks and regulated environments that still want local applications on the portal. The manual does not name industries, so the brief does not either.

Primary roles:

- Bitrix24 on-premise integrators and partners who build or maintain local applications for such customers.
- Portal administrators who need local applications to keep working after the portal is cut off from the internet.

Secondary roles:

- Local application developers who need tokens, token renewal and event delivery without the cloud.
- Operators who deploy the container and database, configure the reverse proxy, watch logs and make backups.

## Primary user problem

A Bitrix24 on-premise portal relies on the cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`) for local applications. When the portal cannot reach the internet, local applications cannot open, cannot call REST with tokens, cannot renew tokens and do not receive online events. Teams in closed networks either give up on local applications or open an internet route they do not want.

## Main value proposition

b24auth-server is an independent, self-hosted server that answers the OAuth calls a Bitrix24 on-premise portal would otherwise send to the cloud. It runs as one container plus one PostgreSQL 17 database inside your network. After the portal is pointed at it, local applications open, call REST, renew tokens and receive events with no connection to the cloud. One server can serve several portals. This was checked on a local test portal whose PHP container was cut off from the internet.

## Key scenarios to emphasize

- Switch a portal to the server with three PHP command-line calls (or `BITRIX_OAUTH_URL` in `local/php_interface/init.php`); the portal registers itself on its next OAuth call.
- Create, update and delete local applications on the portal as usual; the server issues `client_id` / `client_secret` and keeps its registry in step with the portal.
- Open a local application, including one with an install page, and call REST as the correct user, including non-administrators.
- Renew tokens at `/oauth/token/` with reusable refresh tokens, matching behaviour seen in captured cloud traffic.
- Receive portal events, including `ONAPPINSTALL` with freshly issued tokens, at the application handler.

## Business benefits

- Local applications keep working on a portal that has no internet access, so a closed network does not rule out custom integrations.
- No outbound route to the cloud OAuth server is needed for local applications, which removes one external dependency from the portal.
- Also relevant to internet-connected portals that run only the owner's own local applications: app launches, token checks and renewals stop depending on the availability of a remote server the owner does not control. Must always be paired with the limit that Marketplace applications stop working after the switch. Do not claim the cloud server is unreliable or cite outages.
- Tokens and secrets are stored only as hashes, and query strings are not logged, which limits the impact of a database or log leak.
- One server can serve several portals, so a partner or operator does not need one instance per portal.
- Small deployment footprint: one container and one database, a health check at `/health`, JSON logs to standard output and standard PostgreSQL backups.
- The code is open under the MIT license, so integrators can read, audit and adapt it.

## Product objects and systems

- Bitrix24 on-premise portal (tested with `rest` module 26.1100), its `oauth_server` option and service credentials.
- Local applications: `client_id` in the form `local.<14 hex>.<8 digits>`, `client_secret`, redirect URI, scope, handler and install pages.
- Access tokens (3600 seconds) and refresh tokens (180 days); token scope is the intersection of requested and application scope.
- Portal-facing methods: registration, application add/update/delete/list, `rest.authorize`, `rest.check`, `rest.event.call`; application-facing `/oauth/token/`.
- Event delivery to application handlers by HTTP POST.
- PostgreSQL 17, Docker / Docker Compose, a reverse proxy with TLS from an internal CA and IP restriction.
- CI: tests, lint, typecheck, build, container smoke run, `npm audit`; Dependabot weekly updates.

## Important requirements and limits

- Only local applications are supported. Marketplace applications do not work, because their secrets live in the cloud; `application.list` returns an empty list.
- Local applications created while the portal used the cloud must be re-created, and their new `client_id` / `client_secret` put into each application's configuration.
- Applications that hard-code `https://oauth.bitrix.info/oauth/token/` (most SDKs, including CRest) need a configuration change, or internal DNS plus an internal-CA certificate for the cloud host names.
- Registration has no shared secret, because the portal sends none. The reverse proxy must restrict all paths to portal server IPs, except `/oauth/token` and `/health`. Without that restriction, anyone who can reach `/oauth/register/` with an allowlisted portal address can rotate that portal's credentials and lock it out.
- Events are delivered once with a 10-second timeout; they are not stored or retried, are lost on restart, and are dropped above 200 concurrent deliveries in total or 100 concurrent deliveries to one handler host.
- Run a single instance only: migrations run on start without a lock.
- No licence check: licence fields from the portal are ignored.
- No CD pipeline and no published image: you build the image yourself and move it into the closed network as a tar file.
- `authorization_code` grant and server-side install/uninstall handling are not supported.
- Token lifetimes are fixed; request bodies are limited to 10 MB; the service listens on port 3000 behind your TLS proxy.
- Portal-side prerequisites found in testing: the portal must know its real public URL and port, application URLs need a dotted host name, and the `BX24` script must be served from an internal host.
- Verification so far: 55 passing automated tests against real PostgreSQL, contract tests against captured cloud traffic, a CI container smoke run, and a 10-step end-to-end checklist on a local Docker test portal in a closed network. It has not yet been run in production at a customer.

## Do not claim

- Do not claim marketplace application support, or that "all Bitrix24 applications" work. Only local applications are supported.
- Do not claim a published container image, a release pipeline, or one-command install from a registry. There is no CD and no published image.
- Do not claim production use, customer deployments or proven reliability at scale. It was verified on a local test portal only.
- Do not claim registration is secured by the server itself or "secure out of the box". There is no shared secret; proxy IP restriction is required.
- Do not claim guaranteed, persistent, queued or retried event delivery. Events are delivered once and are not stored.
- Do not claim high availability, clustering or horizontal scaling. It is single-instance.
- Do not claim licence validation or licence enforcement.
- Do not claim affiliation with, endorsement by, or certification from Bitrix24. It is an independent project. Avoid "official", "certified", "approved by Bitrix24" or wording that suggests it is the vendor's own OAuth server; "replacement for the cloud OAuth server" must read as a functional description, not a vendor relationship.
- Do not claim full OAuth 2.0 compliance, introspection, `authorization_code` support, revocation on uninstall or scope enforcement on REST calls. These are roadmap items with no dates.
- Do not claim an admin UI or dashboard. The server has no user interface.
- Do not claim zero changes to existing applications. Applications must be re-created, and hard-coded token URLs must be changed or redirected.
- Do not claim exact parity with the cloud server for every response. Some status codes and the token-bearing event `auth` block shape are inferred, not captured.
- Do not claim compatibility with specific Bitrix24 versions beyond the tested `rest` 26.1100.

## Recommended presentation angle

Frame it as the missing piece for running local applications on a Bitrix24 on-premise portal in a closed network: "keep your local apps working when the portal has no internet." Lead with the problem the reader already has (local apps break without the cloud OAuth server), then show the short path: deploy one container and one database, restrict it at the proxy, point the portal at it. Make the trade-offs part of the pitch rather than fine print: an integrator in a regulated network trusts a README that states the security model (proxy IP restriction is the control), the single-instance and no-retry limits, and the verification status up front. State early and plainly that it is an independent open-source project, not a Bitrix24 product.

## Search and FAQ intents

- Primary: Bitrix24 on-premise local applications without internet access / self-hosted Bitrix24 OAuth server.
- Secondary: replace `oauth.bitrix.info` in a closed network; Bitrix24 box `oauth_server` option; token renewal for local apps offline; deliver Bitrix24 events in an isolated network.
- FAQ: Do marketplace applications work? (No, only local applications.)
- FAQ: Do I have to re-create my existing local applications? (Yes, if they were created while the portal used the cloud.)
- FAQ: My SDK hard-codes `oauth.bitrix.info`. What do I change? (The token URL in the app config, or internal DNS plus an internal-CA certificate.)
- FAQ: How is registration protected? (By reverse-proxy IP restriction; the portal sends no shared secret.)
- FAQ: What happens if my event handler is down? (The failure is logged once; the event is not retried.)
- FAQ: Can I run several instances? (No, run one.)
- FAQ: Is this an official Bitrix24 product? (No, it is an independent project.)
- FAQ: How do I roll back to the cloud? (Delete the portal options; re-create local apps again.)
