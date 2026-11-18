# event-delivery Specification

## Purpose
TBD - created by archiving change oauth-server-mvp. Update Purpose after archive.
## Requirements
### Requirement: Accept events from the portal
`rest.event.call` SHALL accept `QUERY`, a list of items in the `Bitrix\Rest\Sqs::queryItem`
format (`client_id`, `auth`, `query.QUERY_URL`, `query.QUERY_DATA`, `additional`), and
respond with `{"result": null}` without waiting for handler delivery to finish.

#### Scenario: Portal hands over events
- **WHEN** a portal calls `rest.event.call` with two items
- **THEN** the server responds with `result` null and schedules both deliveries

### Requirement: Deliver once with a fresh token
For each item the server SHALL send one HTTP POST (form-encoded) to `query.QUERY_URL`
with fields `event`, `event_handler_id`, `data`, `ts` taken from `QUERY_DATA`, and an
`auth` block. When `client_id` is set, `auth.LOCAL_USER` is greater than 0 and
`additional.sendAuth` is true, the `auth` block SHALL contain a newly issued token
response plus `user_id` and `application_token`; `refresh_token` SHALL be included only when
`additional.sendRefreshToken` is true. Otherwise `auth` SHALL contain only `domain`,
`client_endpoint`, `server_endpoint`, `member_id` and `application_token`.

#### Scenario: Install event reaches a server-side app
- **WHEN** a portal sends an `ONAPPINSTALL` item with `sendAuth` and `sendRefreshToken` true for user 1
- **THEN** the app handler receives a POST whose `auth` contains `access_token`, `refresh_token`, `domain`, `member_id` and `application_token`

#### Scenario: Event without user auth
- **WHEN** an item has no `client_id` or `LOCAL_USER` is 0
- **THEN** the handler receives `auth` with only `domain`, `client_endpoint`, `server_endpoint`, `member_id` and `application_token`

### Requirement: No retries in this stage
A failed delivery (connection error, timeout, non-2xx status) SHALL be logged with the
portal, client_id, event name and handler URL, and SHALL NOT be retried. Pending
deliveries SHALL NOT survive a server restart.

#### Scenario: Handler is down
- **WHEN** the handler URL refuses the connection
- **THEN** the server logs the failure once and does not send the event again

#### Scenario: Overload
- **WHEN** an item arrives while the number of deliveries in flight is at the configured limit
- **THEN** the server logs the item as dropped and does not deliver it

