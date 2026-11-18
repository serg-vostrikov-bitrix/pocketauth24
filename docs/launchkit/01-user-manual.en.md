# b24auth-server User Manual

## What The App Does

b24auth-server is a self-hosted replacement for the Bitrix24 cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`). It lets local applications on Bitrix24 on-premise portals work in a closed network, where the portal cannot reach the internet.

You run it as one container plus one PostgreSQL 17 database inside your network. You then point the portal at it. After that, the portal registers itself on the server, local applications get tokens from it, and the server delivers portal events to application handlers.

One server can serve several portals.

## Who It Is For

| Role | What they do with it |
|---|---|
| Portal administrator | Switches the portal to the server, creates local applications, re-creates applications that were created while the portal used the cloud. |
| Local application developer | Gets `client_id` / `client_secret` for a local app from the portal, renews tokens at the server, receives events at the app handler. |
| Operator | Deploys the container and database, sets up the reverse proxy with TLS and IP restriction, watches logs, makes database backups. |

## Main User Value

Without internet access the portal cannot reach the cloud OAuth server, so local applications cannot open, call REST methods, renew tokens or receive online events. With b24auth-server in the closed network, the following work with no internet access:

- opening a local application in the portal (with or without an install page);
- REST calls from the application with the issued tokens;
- token renewal;
- event delivery to application handlers.

This was checked on a test portal cut off from the internet (see "What Was Verified And How").

## Key Scenarios

### 1. Switch a portal to the server

1. Deploy the server and the reverse proxy (see "Deployment").
2. Add the portal host (and port, if not default) to `PORTAL_ALLOWLIST`.
3. On the portal ("PHP command line" in the admin panel) run:

   ```
   \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://auth.corp.local');
   \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
   \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);
   ```

   Alternative: define `BITRIX_OAUTH_URL` in `local/php_interface/init.php` (overrides the `oauth_server` option).
4. The portal registers itself on its next OAuth call.

Result: the server stores the portal and its service credentials. Registering again (repeat the deletion) issues new service credentials; the portal's applications and tokens are kept.

### 2. Create and manage local applications

1. On the portal open Developer resources, Other, Local application, and create the application (with a handler page and, if needed, an install page).
2. The portal creates the application on the server. The server returns a `client_id` in the form `local.<14 hex>.<8 digits>` and a `client_secret`.
3. The application is usable immediately. The portal does not call the server to install or uninstall local applications.
4. Updating title, redirect URI or scope on the portal updates them on the server; new tokens carry the new scope.
5. Deleting the application on the portal removes it from the server together with all its tokens.

A portal can only change or delete applications that belong to it.

### 3. Open a local application

1. A user opens the application in the portal.
2. The portal asks the server for tokens for that user. For an application with an install page, the install page opens with tokens, and after `BX24.installFinish()` the portal marks the application installed.
3. The application calls REST methods on the portal with the access token; the portal checks the token on the server.

Result: the application sees the correct user, including non-administrators.

### 4. Renew tokens

The application renews tokens at `/oauth/token/` (GET or POST) with `grant_type=refresh_token`, `client_id`, `client_secret` and `refresh_token`.

- The result is a new access token and a new refresh token for the same user and scope.
- Access tokens live 3600 seconds; refresh tokens live 180 days.
- A refresh token can be used again until it expires; each use gives another new pair. This matches the behaviour observed in captured real cloud traffic.
- Applications that hard-code `https://oauth.bitrix.info/oauth/token/` need one of two changes (see "Deployment", step 8).

### 5. Receive events at a handler

The portal hands events to the server; the server sends one HTTP POST per event to the application handler.

- For `ONAPPINSTALL` and other events sent with authorisation, the handler receives a freshly issued access token (and a refresh token when the portal asks for it), plus `domain`, `member_id`, `application_token` and the user id.
- For events without a user, the handler receives only `domain`, `client_endpoint`, `server_endpoint`, `member_id` and `application_token`.
- The server responds to the portal immediately, without waiting for delivery.

## Additional And Error Scenarios

| Situation | What happens |
|---|---|
| Portal not in the allowlist tries to register | Registration is refused with an error; nothing is stored. |
| Portal sends wrong service credentials | Error `invalid_client`; no action is performed. |
| Portal calls an unimplemented method | Error `ERROR_METHOD_NOT_FOUND`. |
| `rest.authorize` for an application the portal does not own | Error `ERROR_OAUTH`, "Application not installed". |
| Unknown token (including tokens of a deleted application, or another portal's token) | Error `invalid_token`. |
| Expired access token | Error `expired_token`. |
| Unknown or expired refresh token | Error `invalid_grant`. |
| Wrong application secret on renewal | Error `invalid_client`. |
| Unsupported `grant_type` on renewal | Error `invalid_request` (`invalid_grant` for `authorization_code`). |
| Event handler is down or answers non-2xx | One log entry `event_delivery_failed`; the event is not sent again. |
| Too many deliveries in flight (limit 200) | The event is dropped and logged as `event_dropped_overload` with `limit: global`. |
| Too many deliveries in flight to one handler host (limit 100) | The event is dropped and logged as `event_dropped_overload` with `limit: host`. Other handler hosts still get their events. |
| Unknown path | Error `not_found`. |

The portal caches `rest.check` results for 3600 seconds, so after an application is deleted its old access token may keep working until that cache expires (or is cleared on the portal).

## Implemented Functionality

- Portal registration with an allowlist (`PORTAL_ALLOWLIST`, matched against the host and port of the portal's `redirect_uri`, case-insensitive).
- Portal authentication of every service call by `client_id` and `client_secret`; all data is scoped to the calling portal.
- Local applications: add, update, delete, list. `application.list` always returns an empty list.
- `rest.authorize`: issues a token pair; the token scope is the intersection of the requested scope and the application scope.
- `rest.check`: validates an access token for the calling portal.
- `/oauth/token/`: renewal with reusable refresh tokens.
- `rest.event.call`: event delivery, including `ONAPPINSTALL` with tokens.
- Hashed token storage: only hashes of access tokens, refresh tokens and secrets are stored; tokens are generated from a cryptographically secure random source.
- Log redaction: query strings are not logged (they carry secrets), and event handler URLs are logged without credentials or query.
- Hourly deletion of token pairs whose refresh token has expired.
- Health check at `/health`, answering `{"status":"ok"}`.
- JSON logs to standard output.
- Trailing slashes are accepted on all paths (for example `/oauth/register` and `/oauth/register/`).

## Result Of The App

After deployment and switching the portal, the portal talks only to your server for OAuth. Local applications open, call REST, renew tokens and receive events with no connection to the cloud.

## What Was Verified And How

| Check | What it covers |
|---|---|
| Automated tests (55 tests) | Integration tests against real PostgreSQL for every scenario of the four specifications (portal registration, application registry, token service, event delivery), routing and health; a unit test for scope intersection; a unit test for the capture sanitiser. |
| Contract tests against captured real cloud traffic | Response shapes and error codes of this server are compared with traffic recorded between a test portal (rest 26.1100) and the cloud server `oauth.bitrix.info` on 2026-11-18. The capture confirmed that the cloud accepts the same refresh token repeatedly. |
| Container smoke run (in CI) | The container starts, `/health` answers, a portal registers, there are no error-level log entries, the process does not run as root. |
| End-to-end checklist, run 2026-11-18 (closed network) | On a local Docker portal (rest 26.1100) whose PHP container was cut off from the internet: registration, local app creation, install page with tokens, `user.current` as administrator, non-administrator token (checked with a REST call, not in the browser), `ONAPPINSTALL` with tokens, event token on `/rest/profile`, renewal and repeated renewal, deletion. All 10 steps passed. |

An earlier run of the same checklist, with internet access not blocked, also passed; there the server log showed every OAuth call reaching this server.

Not captured from the real cloud and therefore inferred: the HTTP status codes of portal-call `invalid_client` (401) and unknown method (400), the `expired_token` status (401), and the exact shape of a token-bearing event `auth` block.

## CI And Dependency Updates

CI runs on pushes to `main` and on pull requests. Jobs:

| Job | What it does |
|---|---|
| `test` | Node.js 24, PostgreSQL 17 service; `npm ci`, lint, typecheck, tests, build. |
| `container` | Builds and starts the Docker Compose stack, then runs the smoke test described above. |
| `audit` | `npm audit` for production dependencies at high severity. |

Dependabot checks npm packages, GitHub Actions and Docker base images weekly.

There is no CD or release pipeline and no published image. You build the image yourself (see step 2 below).

## Deployment

### Requirements

- Docker and Docker Compose.
- PostgreSQL 17 (the supplied `docker-compose.yml` runs `postgres:17` with a volume).
- A reverse proxy with TLS (a certificate from your internal CA that portal servers and application servers trust) and IP restriction.
- One server instance only: database migrations run on start and are not locked.

### Steps

1. **What you deploy.** One container (`b24auth-server`) and one PostgreSQL 17 database. The service listens on plain HTTP port 3000; TLS ends at your reverse proxy.
2. **Move the image into the closed network.** On a machine with internet access: `docker build -t b24auth-server:<version> .`, `docker pull postgres:17`, `docker save b24auth-server:<version> postgres:17 -o b24auth-server-<version>.tar`. Copy the tar file and `docker-compose.yml` into the closed network, then `docker load -i b24auth-server-<version>.tar` and `docker tag b24auth-server:<version> b24auth-server:local`.
3. **Configure.** Create `.env` next to `docker-compose.yml`:

   | Variable | Example | Meaning |
   |---|---|---|
   | `BASE_URL` | `https://auth.corp.local` | Public URL behind the proxy; becomes `server_endpoint`. |
   | `DATABASE_URL` | `postgres://b24auth:<password>@db:5432/b24auth` | Database connection. |
   | `PORTAL_ALLOWLIST` | `portal.corp.local,crm.corp.local:8443` | Portal `host[:port]` allowed to register. A portal on a non-default port must be listed with the port. |

   Also set `POSTGRES_PASSWORD` in `.env` to the same password as in `DATABASE_URL`. All three variables are required; the server does not start without them.
4. **Start.** `docker compose up -d`. Migrations run on start. Check `https://auth.corp.local/health`.
5. **Reverse proxy and TLS.** Proxy `https://<BASE_URL host>/` to `http://<app host>:3000/`. Restrict access:
   - Deny by default. Allow every path only from the portal servers' IP addresses, except `/oauth/token` and `/health`, which application servers and monitoring may reach.
   - Write rules that match paths with and without the trailing slash.
   - Keep the app port on the loopback interface (`127.0.0.1:3000`, as in `docker-compose.yml`), or publish it only on the private interface the proxy uses.
6. **Switch the portal** (Key scenario 1).
7. **Re-create local applications.** Applications created while the portal used the cloud have credentials only the cloud knows. Re-create each one on the portal and update its `client_id` / `client_secret` in the application's configuration.
8. **Token renewal URL.** Most SDKs (CRest, official SDKs) hard-code `https://oauth.bitrix.info/oauth/token/`. Either change the application configuration to `https://auth.corp.local/oauth/token/` (preferred), or point DNS for `oauth.bitrix.info` and `oauth.bitrix24.tech` to the reverse proxy and issue a certificate for those names from the internal CA trusted by the application servers.

### Operations

- Logs: JSON to standard output (`docker compose logs app`).
- Backup: standard PostgreSQL dumps of the `b24auth` database.
- Event failures appear in the log as `event_delivery_failed` and `event_dropped_overload`.

### Rollback

1. On the portal delete the `oauth_server` option and the `service_client_id` / `service_client_secret` options.
2. The portal registers with the cloud again when internet access is available.
3. Local apps created against this server must be re-created again; their tokens stop working.
4. Stop the service with `docker compose down` (keep the database volume until you are sure).

## Portal-Side Requirements

Found during the end-to-end run. These are portal behaviours, not server defects.

- The portal must know its real public URL and port. Behind a proxy on a non-default port the portal reported port 80 in the run; the application frame then got a wrong `DOMAIN` and `BX24` could not reach the portal.
- Local application and handler URLs need a host name that contains a dot. `localhost` is rejected by the portal; use an FQDN or an IP address.
- Applications usually load `BX24` from `//api.bitrix24.com/api/v1/`, which is unreachable in a closed network. Serve a copy of that script from an internal host and point the applications at it.
- The portal refuses REST calls for a user who never logged in.

## Unsupported Features

- Marketplace applications: their secrets live in the cloud; only local applications work. `application.list` returns an empty list.
- Event persistence and retries: events are not stored and not retried.
- Licence check: licence fields sent by the portal are ignored.
- `authorization_code` grant: not supported on `/oauth/token/` (answered with `invalid_grant`).
- Server-side install and uninstall handling for local applications (the portal does not call the server for them).

## Limits And Rules

- **No registration secret.** Registration cannot be protected by a shared secret because the portal sends none. Anyone who can reach `/oauth/register/` with an allowlisted portal address can rotate that portal's credentials and lock the portal out. The reverse proxy (IP restriction) is the control. The same applies to the portal-facing `/rest/` calls.
- **Events** are delivered once, with a 10 second timeout per attempt. Pending deliveries are lost when the server restarts. At most 200 deliveries run at once, and at most 100 of them go to one handler host; further events are dropped and logged.
- **Single instance.** Run one application instance.
- **Token lifetimes** are fixed: access 3600 seconds, refresh 180 days.
- **Request size:** request bodies up to 10 MB.
- **Port:** the service listens on 3000.

## Roadmap Mentioned In The Documentation

The analysis document proposes further stages, not implemented in the current release:

- Full OAuth 2.0 and introspection (`rest.code`, `/oauth/authorize/`, `app.info`, revocation on uninstall, scope checks, licence-signature check).
- A persistent event queue with retries and logging.
- Operations features: an admin page (applications, tokens, queue), migration of an already registered portal, a DNS/TLS guide for applications that hard-code `oauth.bitrix.info`.

The documentation does not give dates for these stages.

## Screens And States

The server has no user interface. Its observable states are the health check (`/health`), the JSON log output, and the portal's own screens (local application list, application pages, `BX24` calls).

## License

The repository contains an MIT license file (copyright 2026 Serg Vostrikov).

## Final User Outcome

An operator deploys one container and one database inside the closed network, restricts access at the proxy, and points the portal at it. The portal administrator creates local applications; developers renew tokens and receive events through the server. Marketplace applications, event retries and the roadmap stages are not available.
