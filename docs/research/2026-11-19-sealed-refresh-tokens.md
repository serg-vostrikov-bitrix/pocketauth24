# Sealed refresh tokens: analysis

Date: 2026-11-19
Status: analysis, not started. No OpenSpec change exists yet. Issue: #35.

## 1. Goal

Stop the growth of `token_pairs`. Make the size of the token storage depend on the number of
distinct grants, not on the number of issued tokens.

The idea: the refresh token carries its own data and a signature. The server does not store one
row per refresh token. The server stores only one small row per grant.

## 2. Current state

- `issuePair` in `src/tokens.ts` inserts one row for each issued pair. Three callers use it:
  `rest.authorize` (`src/methods/tokens.ts`), event auth (`src/methods/events.ts`) and the
  refresh on `/oauth/token/`.
- A refresh token lives 180 days (`REFRESH_TTL_SECONDS`). An access token lives 3600 s.
- Refresh tokens are reusable (spec D3 of `oauth-server-mvp`). The old pair stays valid.
- Token pruning (issue #28, change `token-pair-pruning`) deletes **used** pairs: pairs whose
  refresh token was presented, or event pairs without a delivered refresh token. It keeps the
  newest `TOKEN_PRUNING_KEEP` used pairs per application and user.
- Pairs that nobody refreshed are never pruned. They live 180 days.

### 2.1 What the portal does (checked in the portal code, rest 26.x)

| Portal action | Server call | New pair? |
| --- | --- | --- |
| Open of an application page or a placement (`app.layout/lib/Filler/AuthTokenFiller.php`) | `rest.authorize` | Yes, on each open |
| Event with `sendAuth` (`rest/lib/event/sender.php`) | `rest.authorize` (here: `rest.event.call`) | Yes, on each event |
| REST call with an access token (`rest/lib/oauth/auth.php`, `check`) | `rest.check` | No |

- The portal does not cache the issue of tokens. `Provider::get()` calls `rest.authorize` each
  time.
- The portal caches only the result of `rest.check`, for `CACHE_TTL = 3600` s. A pair from
  `rest.authorize` goes into the same cache at once (`storeRegisteredAuth`).
- The portal sends `PARAMS` with `LOCAL_USER`, `TZ_OFFSET` and `EVENT_SESSION`.
  `EVENT_SESSION` is a loop-protection counter, not a unique value. On a page open it is
  `CRestUtil::HANDLER_SESSION_TTL = 7`. Thus the `PARAMS` of one user are almost always the same.

**Conclusion:** the main source of rows is page opens. Their pairs are never refreshed, so token
pruning does not remove them. Each open leaves one row for 180 days.

## 3. Design

### 3.1 Grants

Add a table `grants`. One row is one distinct combination of the data that a token carries.

| Column | Note |
| --- | --- |
| `id` | `bigserial` |
| `application_id` | FK to `applications`, `on delete cascade` |
| `user_id` | |
| `scope` | as stored today |
| `params` | jsonb, as stored today |
| `params_hash` | sha256 of the canonical JSON of `params` |
| `salt` | 16 random bytes, part of the HMAC input, never part of the token |
| `created_at`, `last_issued_at` | |

- Unique key: (`application_id`, `user_id`, `scope`, `params_hash`).
- `issuePair` upserts the grant and uses its `id`. Do not overwrite a grant with new data.
  Spec `token-service` requires that `PARAMS` are stored with the token, and that a refresh keeps
  the user, scope and parameters of the old pair. A grant per (application, user) only would
  break this.
- Because `PARAMS` repeat (section 2.1), page opens of one user collapse into one grant.

### 3.2 Refresh token

The refresh token is 32 bytes, written as 64 lowercase hex characters. This is the same length
and alphabet as `randomHex(32)` today, so clients see no change.

| Field | Bytes |
| --- | --- |
| version (4 bits) and `key_id` (4 bits) | 1 |
| `grant_id` | 4 |
| `iat`, issue time in seconds | 4 |
| HMAC-SHA256 over the fields above and the grant `salt`, truncated | 23 (184 bits) |

Refresh procedure:

1. Parse the token. If the HMAC does not match, look the token up in `token_pairs` (old format,
   section 3.5). Never reject a token only because of its first byte: 1 old token in 256 has
   a "valid" version byte by chance.
2. Load the grant. If it does not exist, return `invalid_grant`. A deleted application deletes
   its grants, so its tokens stop working.
3. If `iat + REFRESH_TTL_SECONDS` is in the past, return `invalid_grant`.
4. Check `client_id` and `client_secret`, as today.
5. Issue a new pair for the same grant.

The `grant_id` and `iat` are readable by the holder of the token. This is harmless: a holder
cannot forge a token without the key, and a refresh also needs `client_secret`.

### 3.3 Access token

Keep the access token random (64 hex). Store it in a table `access_tokens`: `access_hash`,
`grant_id`, `expires_at`. The hourly cleanup deletes expired rows.

- The table holds about one to two hours of issued access tokens.
- `rest.check` reads `scope` and `params` from the grant.
- Do not seal the access token. `rest.check` does not need `client_secret`. If the key leaks,
  sealed access tokens let an attacker call portal REST as any user (section 5, risk 3).

### 3.4 Key

- Add the env variable `TOKEN_KEY` (32 random bytes, hex). Keep old keys by `key_id` for
  180 days after a rotation.
- Store a key fingerprint in the database (HMAC of a fixed string). At start, compare it with
  `TOKEN_KEY`. If they differ, stop with the log event `token_key_mismatch`.
- State in `README.md` (all six languages) and `docs/deployment.md`: the key is part of the
  backup. A database dump without the key cannot restore the tokens.

### 3.5 Migration

- Read both formats. A token that fails the HMAC check goes to the lookup in `token_pairs`.
- New pairs use the new format only. `token_pairs` empties itself in 180 days. Then remove the
  table and the old code path.
- Token pruning (#28) is not necessary for new tokens. Keep it for `token_pairs` until the table
  is empty.

### 3.6 Places to change

- `src/tokens.ts`: `issuePair`, `check`, `refresh`, cleanup.
- `src/schema.ts` and a Drizzle migration: `grants`, `access_tokens`, key fingerprint.
- `src/methods/events.ts`, `src/methods/tokens.ts`, `src/routes/oauthToken.ts`, `src/config.ts`.
- `src/admin/dataRoutes.ts` and the admin UI: show grants instead of token pairs.
- `src/status.ts`: the count of active token pairs.
- Specs: `token-service`, `admin-data-browser`, `service-status`, `application-registry`.
- Tests: four test files use `token_pairs`. The current `rest.check` tests with `parameters`
  must pass without changes to their assertions.

## 4. Upstream fallback mode (issue #10)

- Do not wrap the upstream refresh token in a sealed token. A wrapped token is longer
  (130 to 150 characters), and clients can have limits on the token length.
- In the proxy state, tokens from the upstream pass through without changes. The server does not
  check them.
- For the fallback state, store the hash of the latest upstream refresh token per grant. This
  keeps one row per grant instead of one row per refresh. A client can present an older upstream
  refresh token; then the fallback state rejects it. Check this on real traffic.
- Local refresh tokens that the server issues in the fallback state are sealed. After recovery
  the server accepts them until they expire. This costs no storage.

## 5. Risks (premortem 2026-11-19)

| # | Risk | Fix |
| --- | --- | --- |
| 1 | The operator restores a database dump with a new `.env`. All sealed refresh tokens fail at once. Every application must be authorized again. | Key fingerprint check at start (3.4). Document the key as part of the backup. |
| 2 | One grant per (application, user) overwrites `PARAMS` and scope. `rest.check` returns data of another open or device. | Grant key includes `scope` and `params_hash` (3.1). |
| 3 | Sealed access tokens plus a leaked key give forged `rest.check` results for any grant, without `client_secret`. | Keep access tokens random and stored (3.3). |
| 4 | A restore from an old backup reuses `grant_id` values. An old token then matches a new grant of another application or user. | Per-grant `salt` in the HMAC (3.1). |
| 5 | The work is larger than it looks: admin panel, status, four specs, four test files, six READMEs. | Estimate 4 to 6 days. Decide the admin view of grants before the build. |

## 6. Open checks

1. **Measure before the build** (blocking). On a real installation, run:

   ```sql
   select count(*),
          count(distinct (application_id, user_id)),
          count(distinct (application_id, user_id, scope, params))
   from token_pairs;
   select pg_size_pretty(pg_total_relation_size('token_pairs'));
   ```

   Go on only if the rows are about ten times more than the distinct grants and the size is
   significant. If not, token pruning is enough.
2. **Cloud token format.** Not captured. The local test portal runs on a production license key,
   and its registration at the cloud OAuth server can move the production OAuth registration to
   the test portal. Capture the format on a portal with a separate license. The format does not
   block this design: the new tokens keep the current 64-hex format.
3. **Reuse of the upstream refresh token.** Still open from the fallback analysis (issue #10).

## 7. Alternative without a key

On refresh, return the same refresh token and extend its expiry. Keep access tokens in
`access_tokens`. Rows equal the number of grants, and there is no signature key to lose.

The cost: the cloud returns a new refresh token on each refresh, and spec `token-service` says
that a refresh returns a new refresh token. Clients that compare the old and the new value can
behave differently. Compare this alternative with the sealed design before the build.

## 8. Estimate

4 to 6 working days, after the measurement in section 6.1.
