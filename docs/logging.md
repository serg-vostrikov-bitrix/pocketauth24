# Logging rules

This document is the reference for logs in PocketAuth24. Follow it when you add or change code
that can fail.

## 1. Rules

1. **Log every failure.** Do not catch an error and drop it. If a `catch` block returns a fallback
   value, write a log line first. Exception: a parse helper that returns a fixed value for bad
   input (for example `safeUrl`) does not need a log line.
2. **Use a fixed `msg` in `snake_case`.** The `msg` names the event, for example
   `token_cleanup_failed`. Put changing values in fields, not in `msg`. Use the suffix `_failed`
   for an operation that did not complete.
3. **Choose the level by impact.**
   - `error`: a server fault that needs an operator. Examples: an unhandled exception, a failed
     background job.
   - `warn`: a fault outside the server, or a degraded state. Examples: an event handler that does
     not answer, a database that `/health` cannot reach, an HTTP 5xx response.
   - `info`: a normal rejection of a client request (HTTP 4xx) and audit events.
   - CI starts the container and fails if the log has an `error` line. Do not log an expected
     state as `error`.
4. **Send API errors through `fail()`.** In public routes and REST methods, call
   `fail(code, description, status, reason)` from `src/bitrix.ts`. Do not build an error response
   by hand. If one client-visible code has more than one cause, give each cause its own `reason`.
   The `reason` goes to the log only.
5. **Rely on `request_failed`.** The `onSend` hook `logErrorResponse` logs every response with
   HTTP status 400 or higher. Do not add a second log line for the same rejection. An admin route
   that calls `reply.status(4xx).send({ error })` is logged by the hook too.
6. **Put the error object in `err`.** Write `log.error({ err }, 'x_failed')`, so pino logs the
   message and the stack. For a network error where the URL can carry secrets, log a cleaned text
   in `error` instead (see `event_delivery_failed`).
7. **Never log secrets.** Do not log passwords, `client_secret`, access tokens, refresh tokens,
   session IDs, token hashes, token `params` or query strings. Log only a URL origin and path.
   The `req` serializer in `src/app.ts` already removes the query string.
8. **Add context fields.** Add the fields that identify the object: `portal`, `client_id`,
   `login`, `ip`, `status`, `url`. Use the request logger (`request.log` or `ctx.log`), so the line
   has the `reqId`.
9. **Test the log line.** When you add a failure path, assert its `msg` and its key fields in a
   test. Use `t.logs` from `test/helpers.ts`.
10. **Update this document.** When you add, rename or remove a log event, update the table below.

## 2. Error log events

The server writes JSON logs to stdout. Search them by `msg`. Every error response also has a
`reqId` that links it to the `incoming request` and `request completed` lines.

| `msg` | Level | Meaning |
| --- | --- | --- |
| `request_failed` | info (4xx), warn (5xx) | The server sent an error response. Fields: `status`, `error`, `error_description`, and `reason` or `column` when known |
| `unhandled_error` | error | An unexpected exception. The server answered HTTP 500 `internal_error`. `err` has the stack |
| `database_probe_failed` | warn | `/health` could not reach PostgreSQL |
| `status_query_failed` | error | `/api/status` could not read the statistics |
| `token_cleanup_failed`, `session_cleanup_failed` | error | The hourly cleanup failed |
| `event_delivery_failed`, `event_dropped_overload`, `event_counter_failed` | warn | An event delivery or its counter failed |
| `admin_login_failed` | info | A failed admin login. `reason` is `unknown_login` or `wrong_password` |

Some error responses have no description, to match the Bitrix24 cloud. For these, `reason` gives
the cause: `refresh_token_unknown`, `refresh_token_expired`, `client_id_mismatch`,
`client_secret_mismatch`, `client_id_unknown`, `authorization_code_not_supported` or
`host_not_allowed: <host>`.
