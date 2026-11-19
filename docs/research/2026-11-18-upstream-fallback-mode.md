# Upstream fallback mode: analysis

Date: 2026-11-18
Status: analysis, not started. No OpenSpec change exists yet.

## 1. Goal

Add an operating mode in which b24auth-server is a proxy in front of the real Bitrix24 OAuth
server (`oauth.bitrix.info` / `oauth.bitrix24.tech`, below: "the upstream").

- In normal operation, the server forwards all calls to the upstream and only observes them.
- If the upstream stops responding, the server answers the calls itself. Local applications
  continue to work without interruption.
- When the upstream recovers, the server becomes a proxy again.

## 2. Scope and assumptions

- Local applications are written for this server. They always call this server, also for
  `/oauth/token/`. They do not know if the server forwards a call to the upstream.
- Local applications receive events from this server or from the Bitrix24 offline queue
  (`event.offline.get`). The offline queue uses portal REST, so the portal checks the token
  with `rest.check`.
- Marketplace applications are out of scope. They cannot work with this server. In the
  fallback state their tokens fail the check, as they would without this server.
- The upstream must be reachable from the server through a fixed address or an external DNS.

## 3. Design principles

1. **Token validation is always hybrid.** For `rest.check`, look up the local token store
   first, then ask the upstream. A locally issued access token stays valid in all states.
   Thus, after recovery, locally issued tokens expire by themselves within one access-token
   lifetime (3600 s). No separate "drain" state is necessary.
2. **Only token issuance changes with the state.** The affected calls are `rest.authorize`,
   `/oauth/token/` and the token part of `rest.event.call`.
3. **Learn only what the upstream confirmed.** In the proxy state, store hashes of the
   credentials and tokens that the upstream accepted or issued. In the fallback state, accept
   only these values and locally issued values. The rule "store hashes only" stays valid.

## 4. What the proxy learns

| Data | Source in the proxy state |
| --- | --- |
| Portal credentials | Response of `/oauth/register/`, or the first successful RPC call |
| Application `client_id` and `client_secret` | Response of `application.add`, or the first successful refresh through this server |
| Upstream access tokens | Responses of `rest.authorize`, `/oauth/token/` and `rest.check`. Store `parameters` (`LOCAL_USER`, `TZ_OFFSET`), `status`, `date_finish` and the expiry time |
| Upstream refresh tokens | Responses of `/oauth/token/` and `rest.authorize`, and the refresh token in each refresh request that succeeds |

## 5. Refresh in the fallback state

If a client sends a known upstream refresh token while the upstream is down, return a new local
access token and the **same** upstream refresh token.

- This works only if the upstream refresh token is reusable. Captured cloud traffic shows that
  it is reusable. After recovery, the client sends the same refresh token, the server forwards
  it, and the upstream returns a real pair.
- The upstream response does not contain the expiry time of the refresh token. Calculate it
  conservatively from the time when the server first saw the token. If the token expires in
  the fallback state, return `invalid_grant`, as the upstream would.
- The data model must change. Now `token_pairs.refresh_hash` is unique. In this mode, one
  refresh token serves many access tokens. Move refresh tokens to a separate table and add a
  column `origin` with the values `local` and `upstream`.

### 5.1 The only long tail: local refresh tokens

If `rest.authorize` comes in the fallback state, first reuse a live upstream refresh token of
the same application and user. If there is none, issue a local refresh token.

After recovery, the upstream does not know this token. Accept it locally until it expires.
Give local refresh tokens the same lifetime as upstream refresh tokens.

An alternative is to exchange a local refresh token for a real pair: call `rest.authorize` at the
upstream in the name of the portal. This needs the portal secret in a reversible form. It
breaks the rule "store hashes only", so it is not recommended.

## 6. Events

Recommendation: the server delivers events itself in all states. Do not forward
`rest.event.call` to the upstream.

Reasons:

- If the upstream delivers the event, the tokens in the event `auth` block (including
  `ONAPPINSTALL`) do not pass through this server. The fallback state cannot then accept them.
- The upstream cannot reach handlers inside a closed network.

Token source for an event:

| State | Tokens |
| --- | --- |
| Proxy | Call `rest.authorize` at the upstream with the portal credentials from the same `rest.event.call` request. Store the resulting pair. No portal secret is stored in plain form. |
| Fallback | A local access token and the known upstream refresh token of the same application and user. |

The delivery code exists (`src/methods/events.ts`). Only the token source changes.

## 7. Detection of an upstream failure

Use a circuit breaker with three states: closed (proxy), open (fallback), half-open (probe).

| Parameter | Proposed value | Note |
| --- | --- | --- |
| Upstream timeout | 3 s | Must be less than the portal timeout `OAuth\Client::HTTP_SOCKET_TIMEOUT = 15` s |
| Open after | 3 failures in sequence | Configurable |
| Probe interval | 15 s | The probe contains no secrets, for example `/oauth/token/` without parameters, expect `invalid_request` |
| Close after | 3 successful probes in sequence | Hysteresis against flapping |

- A failure is a timeout, a connection or TLS error, or HTTP 5xx.
- HTTP 4xx and Bitrix errors (`ERROR_OAUTH`, `invalid_grant`, `invalid_token`) are not
  failures. Forward them to the caller. A local answer must never replace an upstream
  rejection.
- If one request fails with a network error while the breaker is closed, answer that request
  locally too. The failure counts toward the threshold.
- A false positive costs little, because local tokens stay valid in all states (principle 1).
- The server runs as a single instance, so the breaker state can be in memory.

## 8. Other rules

- Forward all methods that the server does not implement (`application.install`,
  `application.uninstall`, `application.usage.add`, `rest.code`, `batch`, `methods`) without
  changes. Decide the fallback answer for each of them. `application.install` needs special
  attention, because `app.layout` retries it on `Application not installed`.
- In the fallback state, reject portal registration and `application.add`, `application.update`
  and `application.delete`. The upstream does not learn about such changes.

## 9. Security

- If an attacker blocks outgoing traffic, the server goes to the fallback state. This gives no
  new rights, because the server accepts only values that the upstream confirmed or that the
  server issued.
- In the fallback state, revocation in the upstream does not work (for example, a deactivated
  user). The window is equal to the outage duration. The portal already caches `rest.check`
  results for 3600 s.

## 10. Open checks (blocking)

1. Confirm on an internet-connected test portal that the upstream refresh token is reusable,
   and that a refresh does not revoke the previous access token. If the upstream rotates refresh
   tokens, the design in section 5 does not work.
2. Confirm that the event `auth` block from the upstream matches a `rest.authorize` response
   (`application_token`, event session parameters). The README marks this shape as inferred.

## 11. Estimate

4 to 6 working days: upstream HTTP client, circuit breaker, new tables, learning rules, own
event delivery with upstream tokens, and tests.
