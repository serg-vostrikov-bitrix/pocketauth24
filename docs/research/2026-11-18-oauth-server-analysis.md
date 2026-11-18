# Replacing the Bitrix24 OAuth server in a closed network: source analysis

Date: 2026-11-18
Source analysed: Bitrix24 on-premise, `rest` module 26.0.0 (2026-01-28),
`D:\Work\projects\ntc\on-premise\on-premise-src\bitrix\modules\rest`.

## 1. Goal

Local applications written for the on-premise Bitrix24 must keep working in a network
that cannot reach `oauth.bitrix.info` / `oauth.bitrix24.tech`. That needs an alternative
authorization server, and probably an alternative REST event queue, that the portal and
the applications use instead of the cloud one.

## 2. Key finding: the server address is configurable, the protocol is a plain HTTP RPC

The portal does not hold any OAuth server logic. Everything goes to a remote server
through one class, `Bitrix\Rest\OAuth\Client` (`lib/oauth/client.php`).

The server URL is resolved in this order:

1. constant `BITRIX_OAUTH_URL` (or `BITRIXREST_URL`), if defined before the `rest` module loads;
2. option `rest` / `oauth_server` (`lib/Internal/Service/OAuth/AuthorizationServerUrlResolver.php`);
3. by licence region: `https://oauth.bitrix24.tech` for ru, am, az, ge, kz, kg, uz, by,
   otherwise `https://oauth.bitrix.info`.

So the portal can be pointed at another server **without patching the core**:
`Option::set('rest', 'oauth_server', 'https://auth.internal')`.

`Bitrix\Main\Web\HttpClient` allows private IPs by default (`privateIp = true`), so an
internal address works.

### 2.1 Portal → server calls

All calls are `POST {server}/rest/{method}` with form fields. `Client::prepareRequest()`
adds `client_id`, `client_secret` (the portal's own service credentials),
`client_redirect_uri` (portal URL) and `member_id`. If the server answers
`error=verification_needed`, the call is repeated with a licence signature
(`CRestUtil::signLicenseRequest`: `BX_TYPE`, `BX_LICENCE = md5("BITRIX".key."LICENCE")`,
`BX_HASH`).

| Endpoint / method | Called from | Purpose |
|---|---|---|
| `POST /oauth/register/` | `OAuthService::register()` | Portal registers itself; gets `client_id` / `client_secret` stored in options `rest/service_client_id`, `rest/service_client_secret`. Called lazily on first need. |
| `application.add` | `AppTable::onAfterAdd` | Creating a **local app**: the server issues the app's `client_id` / `client_secret`, the portal stores them in `b_rest_app`. |
| `application.update` / `application.delete` | `AppTable::onAfterUpdate` / `onBeforeDelete` | Keep local app title, redirect URI, scope in sync. |
| `application.install` / `application.install.subscription` | `marketplace/application.php`, `app.layout` `AuthTokenFiller` | Mark app installed on the portal (retried on `Application not installed`). |
| `application.uninstall` | `AppTable::uninstall` | Revoke the app. |
| `application.list` | `AppTable::updateAppStatusInfo`, market | Sync paid/trial status of marketplace apps. |
| `application.usage.add` | `UsageStatTable` | Usage statistics. |
| `rest.authorize` | `OAuth\Provider::get()` | **Mint an access/refresh token pair** for app + user. Used when an app page opens (`app.layout`), for placements, BP activities and event auth. |
| `rest.check` | `OAuth\Auth::check()` | **Validate an incoming access token** when an app calls the portal REST. Result is cached 3600 s in managed cache (`oauth_{token}`). |
| `rest.code` | `OAuth\Provider::authorizeClient()` | Issue an **authorization code** for the OAuth 2.0 authorization-code flow (`/oauth/authorize/` page, component `rest.authorize`). |
| `rest.event.call` | `Event\ProviderOAuth::send()` and **direct calls** in bizproc, crm SMS activity, messageservice, intranet placement | Hand over outgoing REST events; the server delivers them to app handlers ("SQS"). |
| `batch`, `methods` | `Client::batch()` | Generic. |

Fields the portal reads back:

- `rest.check` → `result` with `client_id`, `expires` (or `expires_in`), `scope` (comma list),
  `parameters.LOCAL_USER` (becomes `user_id`), optional `status`, `date_finish`.
- `rest.authorize` → `result` with `access_token`, `refresh_token`, `expires`, `scope`,
  `domain`, `member_id`, `status`, `date_finish_format`; errors as
  `error=ERROR_OAUTH` + `error_description` (`Application not installed`,
  `Subscription has been ended`), `PAYMENT_REQUIRED`.
- `rest.code` → `result` with `code`, `redirect_uri`, `domain`, optional `fragment`, `state`.

The server must also echo `parameters` it was given (`LOCAL_USER`, `TZ_OFFSET`,
event session) back in `rest.check`; the portal uses `LOCAL_USER` to log the user in.

### 2.2 Application → server calls

These never touch the portal:

- `GET|POST {server}/oauth/token/` with `grant_type=authorization_code` or
  `grant_type=refresh_token` (token auto-renewal, OAuth 2.0 code exchange).
- `{server}/rest/app.info?auth=...`: token introspection without the portal.

Applications usually hard-code `https://oauth.bitrix.info/oauth/token/` (official SDKs
and CRest do). In the closed network this needs either an app config change or a DNS
override of `oauth.bitrix.info` / `oauth.bitrix24.tech` plus a certificate from the
customer's internal CA.

### 2.3 Events depend on the server too

Online event handlers are **not** called by the portal directly. `Event\Sender` buffers
them and a background job sends them to the server with `rest.event.call`
(`Sqs::queryItem`: `client_id`, `auth` with `LOCAL_USER` and `application_token`,
`query.QUERY_URL`, `query.QUERY_DATA`). The server mints tokens and POSTs to the
handler. **Without a replacement server, no online event reaches any app.** Offline
events (`event.offline.get`) stay local and work already.

## 3. Extension points inside the box

| Point | How to hook | Covers |
|---|---|---|
| `Rest\Application::setAuthProvider()` | event `rest:onApplicationManagerInitialize` | `rest.authorize`, `rest.code` |
| `Event\Sender::setProvider()` | event `rest:onEventManagerInitialize` | `rest.event.call` from `Sender` only |
| `rest:onRestCheckAuth` handler | replace `Bitrix\Rest\OAuth\Auth::onRestCheckAuth` | `rest.check` |
| `OAuth\Auth::setStorage()` | `AuthStorageInterface` | token cache |

Not reachable through these points (they call `OAuthService::getEngine()->getClient()`
directly): `application.add/update/delete/install/uninstall/list`, `application.usage.add`,
`register`, and `sendEvent` from bizproc, crm, messageservice, intranet. They always
go to the configured URL over HTTP.

The cloud uses a separate `oauth` module (`Bitrix\OAuth\*`, `COAuthConstants`) that
acts as an in-process server; it is not shipped in the box, and the `rest` module
skips its own `onRestCheckAuth` handler when `oauth` is installed.

## 4. Module or separate service

Pure interception through extension points alone is **not enough**: several calls
bypass them, and applications need a real HTTP `/oauth/token/` endpoint anyway. So in
any variant something must speak the HTTP protocol above. The choice is *where* it runs.

| | A. Separate service | B. Box module that serves the protocol |
|---|---|---|
| What it is | Standalone app (any stack) with its own DB; portal option `oauth_server` points to it | Bitrix module with controllers at e.g. `https://portal/b24auth/`; module sets `oauth_server` to the portal itself and also plugs into the extension points to skip the HTTP loop on hot paths |
| Deploy in a customer's closed network | One more service, DB, TLS, monitoring | Install a module; nothing else |
| Data | Own registry of portals, apps, tokens | Reuses `b_rest_app` (local apps already store `CLIENT_ID` / `CLIENT_SECRET`), users, agents |
| Several portals per server | Yes | One portal per install (fine for a closed network) |
| Event delivery | Own queue and workers, scales independently | Queue table + agent/cron worker; limited by PHP workers |
| Dependence on box updates | Only the HTTP protocol (stable since 2016) | Protocol + module API; core updates can touch it |
| Load risk | None on portal | Loop-back HTTP from PHP to the same portal for un-cached calls; reduced by provider hooks and the 3600 s token cache |

### 4.1 Decision (2026-11-18)

**Variant A, a separate service**, chosen by the project owner. The analysis leaned
towards B for simpler customer deployment; that trade-off is accepted: customers deploy
one extra service with its own database and TLS. In return the server does not depend
on box module APIs, can serve several portals and scales event delivery independently.
The portal side needs only the `rest` / `oauth_server` option (or `BITRIX_OAUTH_URL`).

## 5. Proposed stages

1. **MVP: tokens and renewal.** Service skeleton, storage of portals, apps and tokens. `/oauth/register/`, `application.add/update/delete/install/uninstall`
   (local apps), `application.list` (empty), `rest.authorize`, `rest.check`,
   `/oauth/token/` with `refresh_token` and `authorization_code`. Done when a local app
   opens in the portal, calls REST and renews its token with no internet access.
2. **Full OAuth 2.0 + introspection.** `rest.code` and the `/oauth/authorize/` flow,
   `/rest/app.info`, token expiry and revocation on uninstall, scope checks,
   `application_token`, licence-signature check (`verification_needed`).
3. **Event queue.** `rest.event.call` → persistent queue → delivery with fresh tokens,
   retries and logging; covers direct `sendEvent` callers.
4. **Operations.** Admin page (apps, tokens, queue), migration of an already registered
   portal (re-register service credentials, import local apps from `b_rest_app`),
   DNS/TLS guide for apps that hard-code `oauth.bitrix.info`.

## 6. Open questions

- Exact response formats of the cloud server are not in the box sources (only the fields
  the portal reads). They should be captured from real traffic against
  `oauth.bitrix24.tech` on a test portal before implementing, especially `rest.check`,
  `rest.authorize`, `/oauth/token/` and the event POST body.
- Marketplace apps: their secrets live in the cloud; in a closed network only local apps
  are in scope unless decided otherwise.
- Event volume expected per customer: decides whether the PHP agent worker is enough.
