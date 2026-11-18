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

| Step | Result | Notes |
|---|---|---|
| 1–10 | | |
