# Deploying PocketAuth24 in a closed network

## 1. What you deploy

One container (`pocketauth24`) and one PostgreSQL 17 database. TLS terminates at your
reverse proxy; the service listens on plain HTTP port 3000. One server can serve several
portals.

## 2. Move the image into the closed network

On a machine with internet access (base images: official `node:26-alpine` from Docker Hub):

    docker build -t pocketauth24:<version> .
    docker pull postgres:17
    docker save pocketauth24:<version> postgres:17 -o pocketauth24-<version>.tar

Copy the tar file and `docker-compose.yml` into the closed network, then:

    docker load -i pocketauth24-<version>.tar
    docker tag pocketauth24:<version> pocketauth24:local

`docker-compose.yml` references the image as `pocketauth24:local`; the `docker tag` step
makes Compose use the loaded image instead of trying to build it (there is no source or
internet access in the closed network).

## 3. Configure

Create `.env` next to `docker-compose.yml`:

| Variable | Example | Meaning |
|---|---|---|
| `BASE_URL` | `https://auth.corp.local` | Public URL behind the proxy; becomes `server_endpoint` |
| `DATABASE_URL` | `postgres://b24auth:<password>@db:5432/b24auth` | Database connection |
| `PORTAL_ALLOWLIST` | `portal.corp.local,crm.corp.local:8443` | Portal `host[:port]` allowed to register; exact, case-insensitive |
| `TRUST_PROXY` | `true` | Optional, default `false`. Accepts only `true` or `false`. Set `true` only when the proxy overwrites `X-Forwarded-For` with the client IP (`proxy_set_header X-Forwarded-For $remote_addr;` in nginx). The admin login rate limit then uses the client IP from that header. If the proxy appends to the header, a client can send a false IP and bypass the limit |
| `TOKEN_PRUNING` | `true` | Optional, default `true`. Accepts only `true` or `false`. If `true`, each new token pair deletes the older pairs of the same application and user whose refresh token was already exchanged (`token_pairs.refreshed_at` is set), that are not among the newest `TOKEN_PRUNING_KEEP` such pairs, and whose access token has expired. A pair whose refresh token was never used stays, unless the server never delivered that token (event auth without `sendRefreshToken`). So a backend that keeps the refresh token from an install or a page open does not lose it. If `false`, each pair stays until its refresh token expires, as in the Bitrix24 cloud |
| `TOKEN_PRUNING_KEEP` | `5` | Optional, default `5`. A positive integer: the number of newest used pairs that each application and user keep. The server reads it also when `TOKEN_PRUNING` is `false` |

If `TRUST_PROXY` or `TOKEN_PRUNING` has any other value, or `TOKEN_PRUNING_KEEP` is not a positive
integer, the server stops at start with an error that names the variable.

`PORTAL_ALLOWLIST` entries are matched against the host of the portal's `redirect_uri`,
including any port (`host[:port]`), case-insensitively. A portal on a non-default port must
be listed with that port; a portal on the default port is listed without one.

Set `POSTGRES_PASSWORD` in `.env` to the same password. Start: `docker compose up -d`.
Migrations run on start. Check: `curl https://auth.corp.local/health` → `{"status":"ok"}`. `/health` runs `SELECT 1`
against PostgreSQL. If the database does not answer within 2 seconds, `/health` returns HTTP 503
and `{"status":"error","database":"down"}`. Monitors and health checks that expect HTTP 200 in
all cases must accept this change.
Run one app instance only (migrations on boot are not locked).

## 4. Reverse proxy and TLS

Proxy `https://<BASE_URL host>/` to `http://<app host>:3000/`. Use a certificate from your
internal CA that the portal servers and application servers trust.

Restrict access at the proxy. `/oauth/register/` has no shared secret, so anyone who can reach it
can rotate an allowlisted portal's credentials and lock the portal out:

- Deny by default. Allow every path only from the portal servers' IP addresses, except
  `/oauth/token` and `/health`, which application servers and monitoring may reach, and the
  public status page: `/`, `/assets/*` and `/api/status`. The status page shows aggregate counts
  only. If the counts must stay internal, restrict these paths like the others.
- Allow `/admin`, `/admin/*` and `/api/admin/*` only from the network of the operators. The admin
  panel has a login rate limit and no default password, but it must not be reachable from the
  portal servers, the application servers or the internet.
- Match paths with and without the trailing slash: the server accepts `/oauth/register` as well
  as `/oauth/register/` (and the same for `/rest/<method>` and `/oauth/token`). A rule written
  only for `/oauth/register/` is bypassed by `/oauth/register`.

Example for nginx:

    location ~ ^/(oauth/token|health|api/status)/?$ {
        proxy_pass http://127.0.0.1:3000;
    }
    location = / {
        proxy_pass http://127.0.0.1:3000;
    }
    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location ~ ^/(admin|api/admin)(/|$) {
        allow 10.0.0.0/24; # operators
        deny  all;
        proxy_set_header X-Forwarded-For $remote_addr; # overwrite, never append
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

Alternative: define `BITRIX_OAUTH_URL` in `local/php_interface/init.php`
(`define('BITRIX_OAUTH_URL', 'https://<BASE_URL host>');`). The constant overrides the
`oauth_server` option, so use one or the other. Do not edit `dbconn.php`. The portal
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

The server counts delivered, failed and dropped deliveries per UTC day in the table
`event_counters`. The status page and `GET /api/status` show the counts for today and for the
last 7 days. The counters store no event content, handler URL, portal or application.

## 8a. Admin panel

The admin panel at `/admin` shows read-only tables of portals, local applications, token
metadata and event counters. Each table has a search field and 50 rows per page. The panel never
shows tokens, token hashes, secrets or token parameters. The state of a token pair comes from the
expiry of its access token.

Set the superuser password before the first login. The server creates no default password:

    docker compose exec app node dist/cli.js superuser set-password

- The command asks for the password twice and shows nothing while you type.
- The password must have at least 12 characters.
- The default login is `admin`. To use another login, add `--login <name>`.
- To set the password from a script, pipe it and add `--password-stdin`:

      printf '%s\n' "$PASSWORD" | docker compose exec -T app node dist/cli.js superuser set-password --password-stdin

- The command never accepts the password as an argument or an environment variable.
- The command runs the database migrations first.
- If you run the command again, it replaces the password and ends all sessions of the
  superuser.

The superuser creates viewers in the panel (Users page). The server generates a 20-character
password for each new viewer and for each password reset, and shows it once. A viewer sees the
data tables only. Only the CLI can change the superuser password.

Sessions and login limit:

- A session ends 12 hours after login. Log out ends it at once.
- The session cookie `b24a_session` always has the `Secure` flag. Browsers accept it on
  `http://localhost`. In production, serve the panel over HTTPS at the proxy.
- The server allows 5 failed logins from one IP address in 15 minutes. After that, it rejects
  logins from that address for the rest of the window. The limit is in memory: a restart resets it.
- The server reserves the attempt before it checks the password. A successful login does not clear
  earlier failures.
- If `TRUST_PROXY` is `false`, or the proxy does not set `X-Forwarded-For`, all clients share the
  proxy IP address for this limit. Set `TRUST_PROXY=true` only when the proxy sets the header.
- If `TRUST_PROXY` is `true`, the proxy must overwrite `X-Forwarded-For` with the client IP. Do
  not use `$proxy_add_x_forwarded_for` for `/api/admin`. That value appends to the header from
  the client. The server then reads the left-most entry, which the client controls, and each
  attempt can get a new limit key.
- The log records each login success, login failure and logout with the login name and the IP
  address. It never records passwords or session IDs.

## 9. Operations

- Logs: JSON to stdout (`docker compose logs app`).
- Expired token pairs are deleted hourly.
- Expired admin sessions are deleted hourly.
- Backup: standard PostgreSQL dumps of the `b24auth` database.

## 10. Rollback

1. On the portal: `\Bitrix\Main\Config\Option::delete('rest', ['name' => 'oauth_server']);`
   and delete `service_client_id` / `service_client_secret` as in section 5.
2. The portal re-registers with the cloud when internet access is available.
3. Local apps created against this server must be re-created again; their tokens stop working.
4. Stop the service: `docker compose down` (keep the volume until you are sure).
