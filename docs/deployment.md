# Deploying b24auth-server in a closed network

## 1. What you deploy

One container (`b24auth-server`) and one PostgreSQL 17 database. TLS terminates at your
reverse proxy; the service listens on plain HTTP port 3000. One server can serve several
portals.

## 2. Move the image into the closed network

On a machine with internet access (base images: official `node:24-alpine` from Docker Hub):

    docker build -t b24auth-server:<version> .
    docker pull postgres:17
    docker save b24auth-server:<version> postgres:17 -o b24auth-server-<version>.tar

Copy the tar file and `docker-compose.yml` into the closed network, then:

    docker load -i b24auth-server-<version>.tar
    docker tag b24auth-server:<version> b24auth-server:local

`docker-compose.yml` references the image as `b24auth-server:local`; the `docker tag` step
makes Compose use the loaded image instead of trying to build it (there is no source or
internet access in the closed network).

## 3. Configure

Create `.env` next to `docker-compose.yml`:

| Variable | Example | Meaning |
|---|---|---|
| `BASE_URL` | `https://auth.corp.local` | Public URL behind the proxy; becomes `server_endpoint` |
| `DATABASE_URL` | `postgres://b24auth:<password>@db:5432/b24auth` | Database connection |
| `PORTAL_ALLOWLIST` | `portal.corp.local,crm.corp.local:8443` | Portal `host[:port]` allowed to register; exact, case-insensitive |

`PORTAL_ALLOWLIST` entries are matched against the host of the portal's `redirect_uri`,
including any port (`host[:port]`), case-insensitively. A portal on a non-default port must
be listed with that port; a portal on the default port is listed without one.

Set `POSTGRES_PASSWORD` in `.env` to the same password. Start: `docker compose up -d`.
Migrations run on start. Check: `curl https://auth.corp.local/health` → `{"status":"ok"}`.
Run one app instance only (migrations on boot are not locked).

## 4. Reverse proxy and TLS

Proxy `https://<BASE_URL host>/` to `http://<app host>:3000/`. Use a certificate from your
internal CA that the portal servers and application servers trust.

Restrict access at the proxy. `/oauth/register/` has no shared secret, so anyone who can reach it
can rotate an allowlisted portal's credentials and lock the portal out:

- Deny by default. Allow every path only from the portal servers' IP addresses, except
  `/oauth/token` and `/health`, which application servers and monitoring may reach.
- Match paths with and without the trailing slash: the server accepts `/oauth/register` as well
  as `/oauth/register/` (and the same for `/rest/<method>` and `/oauth/token`). A rule written
  only for `/oauth/register/` is bypassed by `/oauth/register`.

Example for nginx:

    location ~ ^/(oauth/token|health)/?$ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        allow 10.0.0.10;   # portal server(s)
        deny  all;
        proxy_pass http://127.0.0.1:3000;
    }

- Keep the app port on the loopback interface (`127.0.0.1:3000`, as in `docker-compose.yml`) so
  that nothing bypasses the proxy. If the proxy runs on another host, publish the port only on
  the private interface that the proxy uses.

## 5. Switch the portal

On the portal ("PHP command line" in the admin panel):

    \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://auth.corp.local');
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

Alternative: define `BITRIX_OAUTH_URL` in `bitrix/php_interface/dbconn.php`. The portal
registers itself on its next OAuth call. Registering again later (same deletion) issues new
service credentials; apps and tokens are kept.

## 6. Re-create local applications

Local apps created while the portal used the cloud have credentials only the cloud knows.
Re-create each local app on the portal (Developer resources → Other → Local application) and
update its `client_id` / `client_secret` in the application's own configuration.
Marketplace applications are not supported in a closed network.

## 7. Application token renewal URL

Applications renew tokens at `/oauth/token/`. Most SDKs (CRest, official SDKs) hard-code
`https://oauth.bitrix.info/oauth/token/`. Choose one:
- Change the application's configuration to `https://auth.corp.local/oauth/token/`
  (preferred).
- Or point DNS for `oauth.bitrix.info` (and `oauth.bitrix24.tech`) to the reverse proxy and
  issue a certificate for those names from the internal CA trusted by application servers.

## 7a. Portal URL, app hosts and the BX24 library

- The portal must know its real public URL and port. Behind a proxy on a non-default port the
  portal may assume port 80; the app frame then gets a wrong `DOMAIN` and `BX24` cannot talk to
  the portal.
- Local app and handler URLs need a host name with a dot: `localhost` is rejected by the portal;
  use an FQDN or an IP address.
- Apps usually load `BX24` from `//api.bitrix24.com/api/v1/`, which is unreachable in a closed
  network. Serve a copy of that script from an internal host and point the apps at it.

## 8. Events

Event handlers receive one POST per event with a 10 s timeout; no retries. Failed and dropped
deliveries appear in the container log as `event_delivery_failed` / `event_dropped_overload`.
Pending deliveries are lost on restart.

## 9. Operations

- Logs: JSON to stdout (`docker compose logs app`).
- Expired token pairs are deleted hourly.
- Backup: standard PostgreSQL dumps of the `b24auth` database.

## 10. Rollback

1. On the portal: `\Bitrix\Main\Config\Option::delete('rest', ['name' => 'oauth_server']);`
   and delete `service_client_id` / `service_client_secret` as in section 5.
2. The portal re-registers with the cloud when internet access is available.
3. Local apps created against this server must be re-created again; their tokens stop working.
4. Stop the service: `docker compose down` (keep the volume until you are sure).
