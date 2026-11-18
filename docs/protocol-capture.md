# Protocol capture against the cloud OAuth server

Purpose: record real request/response pairs between a test on-premise portal and the cloud
OAuth server, so contract tests (task 7.1) compare our shapes with the cloud's. Performed
manually by a developer on a test portal **with** internet access. Never on a customer portal.

## Prerequisites

- Test on-premise Bitrix24 portal (rest module 26.x) you may reconfigure.
- A host reachable by the portal with mitmproxy ≥ 10.1 (`mitmdump`, HAR export via `hardump`).
- A second host reachable **from the internet** for the event handler (a temporary VM you
  control; do not use third-party webhook catchers: event bodies carry tokens).
- Node.js and this repository (`npm install`) to run the sanitizer.

## 1. Cloud proxy

On the proxy host (pick the cloud server for the portal's region):

    mitmdump --mode reverse:https://oauth.bitrix24.tech -p 8080 --set hardump=./cloud-capture.raw.har

Point the portal at the proxy (admin "PHP command line"):

    \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'http://<proxy-host>:8080');
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

Deleting the service credentials forces `/oauth/register/` on the next call.

## 2. Event handler capture

On the internet-facing VM run a tiny handler behind mitmdump:

    python3 -m http.server 9000 &
    mitmdump --mode reverse:http://127.0.0.1:9000 -p 8081 --set hardump=./event-handler.raw.har

(`http.server` answers POST with 501; that is fine, only the request body matters.)

## 3. Actions on the portal (in this order)

1. Open Developer resources → Other → Local application. Create a **server-side** local app
   with handler `http://<vm>:8081/handler`, scope `crm,user`, and an **app with UI** with any
   handler URL. → `/oauth/register/`, `application.add`.
2. Install the server-side app. → `rest.event.call` with `ONAPPINSTALL`, then the cloud POSTs
   to the handler.
3. Open the UI app page as an admin. → `rest.authorize`.
4. From the browser console of the app frame copy `access_token`, `refresh_token`; call
   `https://<portal>/rest/profile?auth=<access_token>`. → `rest.check` (valid).
5. Call `https://<portal>/rest/profile?auth=garbage`. → `rest.check` (invalid token error).
6. Renew through the proxy **twice with the same refresh token**:

       curl "http://<proxy-host>:8080/oauth/token/?grant_type=refresh_token&client_id=<app client_id>&client_secret=<app secret>&refresh_token=<refresh_token>"

   Run the identical command again. Record whether the second call returned a new pair (reuse
   allowed) or an error.
7. Once more with `refresh_token=garbage` (invalid grant error) and with
   `grant_type=authorization_code` (unsupported grant error).
8. Delete the UI app. → `application.delete`.

Stop both mitmdump processes (Ctrl+C writes the HAR files).

## 4. Restore the portal

    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'oauth_server']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
    \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

## 5. Sanitize and commit

    npx tsx scripts/sanitize-har.ts cloud-capture.raw.har test/fixtures/cloud-capture.har <portal-host>
    npx tsx scripts/sanitize-har.ts event-handler.raw.har test/fixtures/event-handler.har <portal-host>
    grep -c "<portal-host>" test/fixtures/*.har      # expect 0 for both files
    grep -c "<access_token value from step 4>" test/fixtures/*.har   # expect 0

Delete the `*.raw.har` files afterwards (they are git-ignored but contain live secrets).

## 6. Results (fill in after the capture)

| Question | Observed |
|---|---|
| Second refresh with the same refresh token | _new pair / error code_ |
| HTTP status of `invalid_client`, `invalid_grant`, `unsupported_grant_type` | |
| HTTP status of `rest.check` errors, `ERROR_OAUTH` | |
| Exact RPC path form (`/rest/rest.check` or with `.json`) | |
| Fields in `rest.authorize` result not in our response | |

If reuse is **rejected** by the cloud, stop and reopen the token-service spec in Comet
(Design Doc §10 risk) before release.
