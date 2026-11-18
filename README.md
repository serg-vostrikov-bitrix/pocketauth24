# b24auth-server

**Keep local applications working on a Bitrix24 on-premise portal that has no internet access.**

[![CI](https://github.com/serg-vostrikov-bitrix/b24auth-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/serg-vostrikov-bitrix/b24auth-server/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-55%20passing-brightgreen)
![Contract tests](https://img.shields.io/badge/contract--tested-captured%20cloud%20traffic-blue)
![Closed network](https://img.shields.io/badge/closed%20network-verified%20on%20test%20portal-blue)
![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
<br>
![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)

b24auth-server is an independent, self-hosted server that answers the OAuth calls a Bitrix24 on-premise portal would otherwise send to the cloud OAuth server (`oauth.bitrix.info` / `oauth.bitrix24.tech`). It runs as one container and one PostgreSQL 17 database inside your network. Point the portal at it, and local applications open, call REST, renew tokens and receive events with no connection to the cloud.

> Independent open-source project. Not a Bitrix24 product. See the [disclaimer](#disclaimer).

## 🔒 Why

A Bitrix24 on-premise portal depends on the cloud OAuth server for its local applications. Once the portal cannot reach the internet, local applications cannot open, cannot call REST with tokens, cannot renew tokens and do not receive online events.

Teams in closed corporate networks and regulated environments are left with two bad options: give up on local applications, or open an internet route they do not want. b24auth-server gives them a third: run the OAuth side of local applications inside their own network.

**It pays off with internet access too.** If your clients' portals run only your own local applications, the remote cloud OAuth server adds little: app launches, token checks and renewals still go to a server you do not control, and its availability and the network path to it are outside your hands. With b24auth-server next to the portal, that dependency moves into infrastructure you run and monitor yourself. The trade-off: after the switch, the portal no longer uses the cloud OAuth server, so Marketplace applications stop working on it. This setup is for portals that rely on local applications only.

## ✨ Benefits

- **Local apps survive the air gap.** A closed network no longer rules out custom integrations on the portal.
- **One less external dependency.** Local applications need no outbound route to the cloud OAuth server.
- **Your uptime, not someone else's.** Even on an internet-connected portal that runs only your own local apps, app launches, token checks and renewals no longer depend on a remote server's availability. (Marketplace apps need the cloud and will not work after the switch.)
- **Limits the impact of a database or log leak.** Tokens and secrets are stored only as hashes, and query strings never reach the logs.
- **One server, several portals.** Partners and operators do not need an instance per portal.
- **Small footprint.** One container, one database, a `/health` check, JSON logs to stdout and standard PostgreSQL backups.
- **Open code.** MIT-licensed, so integrators can read, audit and adapt it.

## 🧩 Features available today

| Area                    | What you get                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portal registration** | The portal registers itself on its next OAuth call. Registration is limited to an allowlist (`PORTAL_ALLOWLIST`, matched on host and port). Every service call is authenticated with the portal's own credentials, and all data is scoped to the calling portal. |
| **Local applications**  | Create, update and delete local applications on the portal as usual. The server issues `client_id` (`local.<14 hex>.<8 digits>`) and `client_secret` and keeps its registry in step. Deleting an app removes all its tokens.                                     |
| **Tokens**              | `rest.authorize` issues token pairs for the correct user, including non-administrators; install pages open with tokens. `rest.check` validates tokens. Token scope is the intersection of requested and application scope.                                       |
| **Renewal**             | `/oauth/token/` (GET or POST) with `grant_type=refresh_token`. Refresh tokens are reusable until expiry, matching behaviour seen in captured cloud traffic. Access tokens live 3600 s, refresh tokens 180 days; expired pairs are deleted hourly.                |
| **Events**              | `rest.event.call` delivers each event to the application handler by HTTP POST, including `ONAPPINSTALL` with freshly issued tokens. The portal gets an immediate answer.                                                                                         |
| **Security**            | Hashed storage of tokens and secrets, tokens from a cryptographically secure random source, log redaction (no query strings, handler URLs without credentials), app port bound to loopback (`127.0.0.1:3000`) in `docker-compose.yml`.                           |
| **Operations**          | `/health` returns `{"status":"ok"}`, JSON logs, trailing slashes accepted on all paths.                                                                                                                                                                          |

## ⚙️ How it works

```mermaid
sequenceDiagram
    participant P as Bitrix24 on-premise portal
    participant S as b24auth-server
    participant A as Local application
    P->>S: Register (allowlisted host)
    S-->>P: Service credentials
    P->>S: Add local application
    S-->>P: client_id / client_secret
    P->>S: rest.authorize (user opens the app)
    S-->>P: Access + refresh token
    A->>P: REST call with access token
    P->>S: rest.check
    S-->>P: Token valid for this user
    A->>S: /oauth/token/ (refresh_token)
    S-->>A: New token pair
    P->>S: rest.event.call (e.g. ONAPPINSTALL)
    S->>A: HTTP POST to handler, with tokens
```

OAuth traffic between the portal, local applications and the server stays inside your network. The reverse proxy in front of the server terminates TLS and restricts who can reach which path.

## ✅ Verified

| Check                              | What it covers                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **55 automated tests**             | Integration tests against real PostgreSQL for portal registration, application registry, token service, event delivery, routing and health, plus unit tests.                                                                                                                                                      |
| **Contract tests**                 | Response shapes and error codes compared with traffic captured between a test portal (`rest` 26.1100) and `oauth.bitrix.info`.                                                                                                                                                                                    |
| **Container smoke test (CI)**      | The container starts, `/health` answers, a portal registers, no error-level logs, the process does not run as root.                                                                                                                                                                                               |
| **End-to-end in a closed network** | A 10-step checklist on a local Docker test portal (`rest` 26.1100) whose PHP container was cut off from the internet: registration, app creation, install page with tokens, REST as administrator and non-administrator, `ONAPPINSTALL` with tokens, renewal and repeated renewal, deletion. All 10 steps passed. |

It has not yet been run in production at a customer. A few details were inferred rather than captured from the cloud: some HTTP status codes (`invalid_client`, unknown method, `expired_token`) and the exact shape of a token-bearing event `auth` block.

## 🚀 Quick start

There is no published image: build it on a machine with internet access and carry it into the closed network.

```bash
# Outside the closed network
docker build -t b24auth-server:<version> .
docker pull postgres:17
docker save b24auth-server:<version> postgres:17 -o b24auth-server-<version>.tar

# Inside the closed network (copy the tar and docker-compose.yml first)
docker load -i b24auth-server-<version>.tar
docker tag b24auth-server:<version> b24auth-server:local
```

Create `.env` next to `docker-compose.yml`:

| Variable            | Example                                         | Meaning                                                                      |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `BASE_URL`          | `https://auth.corp.local`                       | Public URL behind the proxy; becomes `server_endpoint`.                      |
| `DATABASE_URL`      | `postgres://b24auth:<password>@db:5432/b24auth` | Database connection.                                                         |
| `PORTAL_ALLOWLIST`  | `portal.corp.local,crm.corp.local:8443`         | Portal `host[:port]` allowed to register; list non-default ports explicitly. |
| `POSTGRES_PASSWORD` | `<password>`                                    | Same password as in `DATABASE_URL`.                                          |

`BASE_URL`, `DATABASE_URL` and `PORTAL_ALLOWLIST` are required; the server does not start without them. Then:

```bash
docker compose up -d                       # migrations run on start
curl https://auth.corp.local/health        # {"status":"ok"}
```

**Reverse proxy (required).** Proxy `https://<BASE_URL host>/` to `http://<app host>:3000/` with a certificate from your internal CA. Deny by default; allow every path only from portal server IPs, except `/oauth/token` and `/health`. Match paths with and without the trailing slash.

**Point the portal at the server.** In the admin panel, "PHP command line":

```php
\Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://auth.corp.local');
\Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
\Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);
```

Alternatively define `BITRIX_OAUTH_URL` in `local/php_interface/init.php` (it overrides the `oauth_server` option; do not edit `dbconn.php`). The portal registers itself on its next OAuth call.

**Then:** re-create local applications that were created while the portal used the cloud, and change hard-coded token URLs (`https://oauth.bitrix.info/oauth/token/`, used by most SDKs including CRest) to `https://auth.corp.local/oauth/token/`, or point internal DNS for the cloud host names at the proxy with an internal-CA certificate.

Full steps, operations and rollback: [docs/deployment.md](docs/deployment.md).

## 🖥️ Requirements on the portal side

Found during the end-to-end run. These are portal behaviours, not server defects.

- The portal must know its **real public URL and port**; otherwise the app frame gets a wrong `DOMAIN` and `BX24` cannot reach the portal.
- Application and handler URLs need a **host name with a dot** (an FQDN or an IP address); `localhost` is rejected.
- **Serve the `BX24` script internally.** Apps usually load it from `//api.bitrix24.com/api/v1/`, which is unreachable in a closed network.
- The portal refuses REST calls for a user who has never logged in.

## 🧭 Limitations and roadmap

Know these before you deploy:

- **Local applications only.** Marketplace applications do not work, because their secrets live in the cloud.
- **Existing apps must be re-created**, and hard-coded token URLs changed or redirected.
- **The proxy is the security control for registration.** The portal sends no shared secret, so anyone who reaches `/oauth/register/` with an allowlisted portal address could rotate that portal's credentials. Restrict it by IP.
- **Events are delivered once**, with a 10-second timeout. They are not stored or retried, are lost on restart and are dropped above 200 concurrent deliveries.
- **Single instance.** Migrations run on start without a lock.
- **Not supported:** licence checks, the `authorization_code` grant, server-side install/uninstall handling. Token lifetimes are fixed; request bodies are limited to 10 MB.
- **No user interface.** You observe the server through `/health`, its logs and the portal's own screens.
- **Tested** with the portal `rest` module 26.1100.

Proposed further stages, with no dates: full OAuth 2.0 and introspection (including revocation on uninstall and scope checks), a persistent event queue with retries, and operations features such as an admin page and migration of an already registered portal.

## 🔁 CI/CD

CI runs on pushes to `main` and on pull requests ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job         | What it does                                                                      |
| ----------- | --------------------------------------------------------------------------------- |
| `test`      | Node.js 24 with a PostgreSQL 17 service: `npm ci`, lint, typecheck, tests, build. |
| `container` | Builds and starts the Docker Compose stack and runs the smoke test.               |
| `audit`     | `npm audit` for production dependencies at high severity.                         |

Dependabot checks npm packages, GitHub Actions and Docker base images weekly.

There is no automated release or publish step yet: no CD pipeline and no published image. You build the image yourself.

## 📚 Documentation

- [Deployment guide](docs/deployment.md): requirements, steps, proxy rules, operations, rollback.
- [End-to-end checklist](docs/e2e-checklist.md): the 10-step closed-network verification.
- [Protocol capture](docs/protocol-capture.md): how the cloud traffic for contract tests was recorded.
- [Research](docs/research/2026-11-18-oauth-server-analysis.md): protocol analysis and proposed roadmap.
- [User manual](docs/launchkit/01-user-manual.en.md): scenarios, error cases, limits.

## 🛠️ Development

Stack: Node.js 24, TypeScript (strict), Fastify, Drizzle, PostgreSQL 17.

```bash
npm install
docker compose up -d db
npm test
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run db:generate`.

Configuration: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (see [`.env.example`](.env.example)).

## 📄 License

[MIT](LICENSE). Copyright 2026 Serg Vostrikov.

## Disclaimer

b24auth-server is an independent project. It is not affiliated with, endorsed by or certified by Bitrix24. "Replacement for the cloud OAuth server" describes what the software does, not a vendor relationship. Bitrix24 and other trademarks belong to their respective owners.
