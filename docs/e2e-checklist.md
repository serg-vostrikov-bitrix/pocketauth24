# End-to-end check on a test portal without internet

Run before each release. Record date, portal version, server image tag and the result of
every step in the table at the end.

## Setup

1. Deploy the server per `docs/deployment.md` on a host the portal reaches; block the portal's
   outbound internet access (firewall rule or isolated network). Confirm
   `curl https://oauth.bitrix.info` fails from the portal host.
2. Point the portal at the server and force registration:

       \Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://<server>');
       \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
       \Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);

## Local app with UI

3. Create a local app with a handler page and an install page (`URL_INSTALL`) that calls
   `BX24.installFinish()`. Scope `crm,user`. Server log shows `application.add`.
4. Open the app as admin. Expected: the install page opens with tokens (`rest.authorize`),
   `BX24.installFinish()` completes, the portal marks the app installed (no server call for it).
5. Open the app again. Expected: the main page opens; `BX24.callMethod('user.current')`
   returns the admin user (`rest.check` in the server log).
6. Open the app as a non-admin user. Expected: `user.current` returns that user.

## Server-side local app

7. Create a server-side local app with handler URL on an internal host that logs POST bodies.
   Expected: the handler receives `ONAPPINSTALL` with `auth.access_token`,
   `auth.refresh_token`, `auth.domain`, `auth.member_id`, `auth.application_token`.
8. Call `https://<portal>/rest/profile?auth=<access_token from step 7>`. Expected: success.

## Renewal

9. For both apps, renew through the server:

       curl "https://<server>/oauth/token/?grant_type=refresh_token&client_id=<id>&client_secret=<secret>&refresh_token=<refresh>"

   Expected: new pair; the new access token works for a portal REST call. Repeat with the same
   refresh token: expected another new pair.

## Delete

10. Delete the UI app. Expected: its old access token is rejected by portal REST after the
    portal's 3600 s `rest.check` cache expires (or after clearing the portal cache).

## Results

### Run 2026-11-18

Local Docker portal (rest 26.1100, region `en`), server image `b24auth-server:local` built from
this branch, run with docker compose on the same host. App pages and the event handler were a
small local HTTP server.

| Step | Result | Notes |
|---|---|---|
| 1 | Partial | Outbound internet was **not** blocked (the portal is shared with other work). Instead, the server log showed every OAuth call (`/oauth/register/`, `application.add`, `rest.authorize`, `rest.check`, `rest.event.call`, `application.delete`) reaching this server; nothing went to the cloud. |
| 2 | Pass | `oauth_server` pointed at the server; registration succeeded. |
| 3 | Pass | `application.add` in the server log for both apps. |
| 4 | Pass | The install page got `AUTH_ID`, `REFRESH_ID`, `APPLICATION_TOKEN`, `member_id`; `BX24.installFinish()` completed; the portal set `INSTALLED=Y` with no server call. |
| 5 | Pass | The main page opened; `BX24.callMethod('user.current')` returned the admin. |
| 6 | Pass | A non-admin user's token returned that user from `user.current` (checked with a portal-issued token and a REST call, not in the browser). |
| 7 | Pass | `ONAPPINSTALL` carried `access_token`, `refresh_token`, `domain`, `member_id`, `application_token` (plus `expires`, `expires_in`, `scope`, `status`, `user_id`, endpoints). |
| 8 | Pass | The event access token worked for `/rest/profile`. |
| 9 | Pass | Both apps: renewal gave a new working pair; the same refresh token again gave another new pair. |
| 10 | Pass | After deleting the UI app and clearing the portal cache, its old and renewed access tokens got `invalid_token`; renewal failed. |

Findings for deployment (portal behaviour, not server defects):

- The portal must know its real public port. Behind the Docker nginx on port 8588 it reported
  port 80, so the app frame got `DOMAIN=localhost` and `BX24` could not reach the portal. The run
  used a port-80 proxy. Configure the portal URL/port correctly in production.
- App and handler URLs need a host with a dot (`HandlerHelper::checkCallback`): `localhost` is
  rejected, `127.0.0.1` or a FQDN works.
- The portal refuses REST for a user who never logged in (`LAST_LOGIN` / `LAST_ACTIVITY_DATE`).
- Apps load `BX24` from `//api.bitrix24.com/api/v1/`. In a closed network that script must be
  served from an internal host; the browser in this run had internet access.

### Run 2026-11-18 (closed network)

Same portal and image as the run above, repeated with the portal's PHP container cut off from the
internet: an `iptables` OUTPUT policy in its network namespace allowed only the portal subnet and
the OAuth server port, and rejected everything else. `curl` to `oauth.bitrix.info`,
`oauth.bitrix24.tech`, `api.bitrix24.com` and `www.google.com` from the PHP container failed
before and after the run. The app pages loaded `BX24` from a local copy on the app host.

| Step | Result | Notes |
|---|---|---|
| 1 | Pass | Outbound internet blocked as described; the server log shows every OAuth call. |
| 2 | Pass | Registration succeeded. |
| 3 | Pass | `application.add` for both apps. |
| 4 | Pass | Install page got `AUTH_ID` and `REFRESH_ID`; `BX24.installFinish()` completed. |
| 5 | Pass | `user.current` returned the admin. |
| 6 | Pass | A non-admin user's token returned that user (REST call, not browser). |
| 7 | Pass | `ONAPPINSTALL` carried tokens, `domain`, `member_id`, `application_token`. |
| 8 | Pass | The event access token worked for `/rest/profile`. |
| 9 | Pass | Both apps: renewal and repeated renewal with the same refresh token gave working new pairs. |
| 10 | Pass | After deletion, old and renewed tokens got `invalid_token`; renewal failed. |

