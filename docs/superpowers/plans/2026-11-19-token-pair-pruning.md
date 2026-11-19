---
change: token-pair-pruning
design-doc: docs/superpowers/specs/2026-11-19-token-pair-pruning-design.md
base-ref: 6c449ccc93ac7c4e9835baf69741f5263b69d0bc
---

# Token pair pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task ids match `docs/openspec/changes/token-pair-pruning/tasks.md`; check off the same id there when a task is done.

**Goal:** When the server issues a token pair, delete the pairs of the same application and user that are older than the newest `TOKEN_PRUNING_KEEP` pairs and whose access token has expired.

**Architecture:** `loadConfig` parses two new variables into `Config.tokenPruningKeep: number | null`. `issuePair` runs the insert and a scoped `DELETE` in one transaction. Three new indexes in `src/schema.ts` serve the prune query, the admin token list and the cascades; Drizzle generates migration `0003`.

**Tech Stack:** TypeScript (ESM, Node.js >= 24), Fastify 5, drizzle-orm 0.45 + drizzle-kit 0.31, PostgreSQL, Vitest 5.

## Global Constraints

- English only for code, comments, docs, commits (CLAUDE.md rule 1). STE style for spec-like prose (rule 2).
- `TOKEN_PRUNING`: `true` or `false` after trim; unset or empty means `true`; other values throw `TOKEN_PRUNING must be "true" or "false"`.
- `TOKEN_PRUNING_KEEP`: matches `/^[1-9]\d*$/` and is a safe integer; unset or empty means `5`; other values throw `TOKEN_PRUNING_KEEP must be a positive integer`. Parse it also when pruning is off.
- The prune `DELETE` never removes a pair with a live access token (`access_expires_at > now`).
- `$now` for the prune is `new Date(Date.now())`, the same clock as the expiry (fake timers in tests control it).
- Callers of `issuePair` (`src/methods/tokens.ts`, `src/methods/events.ts`, `refresh` in `src/tokens.ts`) do not change.
- `README.md` changes go into `README.{de,it,es,pt,ru}.md` in the same PR, same structure. Use the Sepia skill `sepia-refactor` for the English note before translation (rule 4).
- Integration tests need local Postgres. `TEST_DATABASE_URL` defaults to `postgres://b24auth:b24auth@localhost:5432/b24auth_test`; `test/global-setup.ts` creates the database and runs migrations.
- `docs/` is in `.prettierignore`; `README*.md` and `src/`, `test/` are not, so `npm run lint` checks them.
- Do not commit unless the Comet build flow asks for it; the commit steps below give the message to use then.

## File map

| File                                     | Change                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| `src/config.ts`                          | `Config.tokenPruningKeep`, two parse functions             |
| `test/unit/config.test.ts`               | defaults, `false`, keep value, invalid-value tables        |
| `src/tokens.ts`                          | `issuePair` in a transaction with the prune `DELETE`       |
| `test/helpers.ts`                        | `TEST_CONFIG.tokenPruningKeep: 5`; `startApp({ config })`  |
| `test/integration/token-service.test.ts` | `Pruning` describe block, 4 tests                          |
| `src/schema.ts`                          | 3 indexes                                                  |
| `drizzle/0003_token_pair_indexes.sql`    | generated, plus `drizzle/meta/0003_snapshot.json`, journal |
| `docs/deployment.md`                     | 2 table rows, 1 sentence                                   |
| `README.md` + 5 translations             | 2 table rows, 1 note                                       |

---

### Task 1.1: Configuration

**Files:**

- Modify: `src/config.ts:17-50`
- Modify: `test/helpers.ts:22-27` (only to keep `npm run typecheck` green: `TEST_CONFIG` must satisfy `Config`)
- Test: `test/unit/config.test.ts`

**Interfaces:**

- Produces: `Config.tokenPruningKeep: number | null` (`null` means pruning is off). `TEST_CONFIG.tokenPruningKeep === 5`.

- [ ] **Step 1: Write the failing tests** — append to `test/unit/config.test.ts`:

```ts
const keep = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ ...base, ...env }).tokenPruningKeep;

it('tokenPruningKeep is 5 when both variables are unset or empty', () => {
  expect(keep()).toBe(5);
  expect(keep({ TOKEN_PRUNING: '', TOKEN_PRUNING_KEEP: '' })).toBe(5);
  expect(keep({ TOKEN_PRUNING: ' true ' })).toBe(5);
});

it('tokenPruningKeep is null when TOKEN_PRUNING=false', () => {
  expect(keep({ TOKEN_PRUNING: 'false' })).toBeNull();
});

it('tokenPruningKeep takes TOKEN_PRUNING_KEEP', () => {
  expect(keep({ TOKEN_PRUNING_KEEP: '2' })).toBe(2);
});

it.each(['TRUE', 'yes', '1'])('TOKEN_PRUNING=%j throws at boot', (value) => {
  expect(() => keep({ TOKEN_PRUNING: value })).toThrow(/TOKEN_PRUNING must/);
});

it.each(['0', '-1', 'abc', '1.5', '99999999999999999999'])(
  'TOKEN_PRUNING_KEEP=%j throws at boot',
  (value) => {
    expect(() => keep({ TOKEN_PRUNING_KEEP: value })).toThrow(/TOKEN_PRUNING_KEEP/);
  },
);

it('an invalid TOKEN_PRUNING_KEEP throws also when pruning is off', () => {
  expect(() => keep({ TOKEN_PRUNING: 'false', TOKEN_PRUNING_KEEP: '0' })).toThrow(
    /TOKEN_PRUNING_KEEP/,
  );
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npm test -- test/unit/config.test.ts`
Expected: FAIL; `tokenPruningKeep` is `undefined`, and the throw cases do not throw.

- [ ] **Step 3: Implement** in `src/config.ts`:

```ts
export type Config = {
  baseUrl: string;
  databaseUrl: string;
  portalAllowlist: string[];
  trustProxy: boolean;
  tokenPruningKeep: number | null; // null: pruning is off
};

function parseTokenPruning(value: string | undefined): boolean {
  const text = value?.trim() ?? '';
  if (text === '' || text === 'true') return true;
  if (text === 'false') return false;
  throw new Error('TOKEN_PRUNING must be "true" or "false"');
}

function parseTokenPruningKeep(value: string | undefined): number {
  const text = value?.trim() ?? '';
  if (text === '') return 5;
  const keep = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(keep)) {
    throw new Error('TOKEN_PRUNING_KEEP must be a positive integer');
  }
  return keep;
}
```

In `loadConfig`, parse both before the `return` so a bad keep value fails also when pruning is off:

```ts
const pruningKeep = parseTokenPruningKeep(env.TOKEN_PRUNING_KEEP);
// ... in the returned object:
    tokenPruningKeep: parseTokenPruning(env.TOKEN_PRUNING) ? pruningKeep : null,
```

In `test/helpers.ts`, add `tokenPruningKeep: 5,` to `TEST_CONFIG`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test -- test/unit/config.test.ts` then `npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/unit/config.test.ts test/helpers.ts
git commit -m "feat(config): add TOKEN_PRUNING and TOKEN_PRUNING_KEEP"
```

---

### Task 2.2 then 2.1: Pruning (tests first)

Write 2.2 (tests) first, then 2.1 (implementation). Check off both ids at the end.

**Files:**

- Modify: `test/helpers.ts:37-50` (`startApp` option `config`)
- Test: `test/integration/token-service.test.ts` (new `describe('Pruning')` at the end of the file)
- Modify: `src/tokens.ts:1-6` (imports), `src/tokens.ts:91-119` (`issuePair`)

**Interfaces:**

- Consumes: `Config.tokenPruningKeep` (Task 1.1).
- Produces: `startApp(options: { databaseUrl?: string; webRoot?: string; config?: Config })`. `issuePair` signature does not change.

- [ ] **Step 1 (2.2): Add the `config` option to `startApp`** in `test/helpers.ts`:

```ts
export async function startApp(
  options: { databaseUrl?: string; webRoot?: string; config?: Config } = {},
): Promise<TestApp> {
  // ...
  const app = await buildApp({
    config: options.config ?? TEST_CONFIG,
    db,
    logStream,
    webRoot: options.webRoot,
  });
```

- [ ] **Step 2 (2.2): Write the failing tests** — append to `test/integration/token-service.test.ts`. Add `TEST_CONFIG` to the `../helpers.js` import. `truncateAll` in the top-level `beforeEach` resets ids, so the first application has id 1 and the second id 2.

```ts
async function authorizeTimes(
  app: TestApp,
  portal: Credentials,
  clientId: string,
  times: number,
  localUser = '5',
): Promise<TokenResponse[]> {
  const tokens: TokenResponse[] = [];
  for (let i = 0; i < times; i++) {
    tokens.push(await authorize(app.app, portal, clientId, { PARAMS: { LOCAL_USER: localUser } }));
  }
  return tokens;
}

async function pairCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of await t.db.select().from(tokenPairs)) {
    const key = `${row.applicationId}:${row.userId}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('Pruning', () => {
  it('Old expired pairs are deleted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const [oldest] = await authorizeTimes(t, portal, app.client_id, 5);

    vi.setSystemTime(Date.now() + 3600 * 1000);
    await authorizeTimes(t, portal, app.client_id, 1);

    expect(await pairCounts()).toEqual({ '1:5': 5 });
    const res = await tokenRequest(t.app, 'POST', refreshParams(app, oldest.refresh_token));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('Live access tokens are kept', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    await authorizeTimes(t, portal, app.client_id, 7);

    await authorizeTimes(t, portal, app.client_id, 1);

    expect(await pairCounts()).toEqual({ '1:5': 8 });
  });

  it('Other users and applications are not touched', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const appA = await addApp(t.app, portal);
    const appB = await addApp(t.app, portal);
    await authorizeTimes(t, portal, appA.client_id, 6, '5');
    await authorizeTimes(t, portal, appA.client_id, 6, '6');
    await authorizeTimes(t, portal, appB.client_id, 6, '5');

    vi.setSystemTime(Date.now() + 3600 * 1000);
    await authorizeTimes(t, portal, appA.client_id, 1, '5');

    // An unscoped DELETE would cut 1:6 and 2:5 to 4 or fewer.
    expect(await pairCounts()).toEqual({ '1:5': 5, '1:6': 6, '2:5': 6 });
  });

  describe('when TOKEN_PRUNING=false', () => {
    let off: TestApp;
    beforeAll(async () => {
      off = await startApp({ config: { ...TEST_CONFIG, tokenPruningKeep: null } });
    });
    afterAll(async () => {
      await off.close();
    });

    it('Pruning is off', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const portal = await registerPortal(off.app);
      const app = await addApp(off.app, portal);
      await authorizeTimes(off, portal, app.client_id, 5);

      // Same setup as "Old expired pairs are deleted", which deletes one pair with pruning on.
      vi.setSystemTime(Date.now() + 3600 * 1000);
      await authorizeTimes(off, portal, app.client_id, 1);

      expect(await pairCounts()).toEqual({ '1:5': 6 });
    });
  });
});
```

Note: `TestApp` is already imported as a type. `tsconfig.json` has no `noUncheckedIndexedAccess`, so `oldest` is typed `TokenResponse`; do not add a `!` (the type-checked ESLint config rejects an unnecessary assertion).

- [ ] **Step 3 (2.2): Run the tests and see them fail**

Run: `npm test -- test/integration/token-service.test.ts`
Expected: FAIL in "Old expired pairs are deleted" (`{ '1:5': 6 }` instead of 5, refresh returns 200) and in "Other users and applications are not touched" (`'1:5': 7`). "Live access tokens are kept" and "Pruning is off" pass already; this is correct, they guard against over-deletion.

- [ ] **Step 4 (2.1): Implement the prune** in `src/tokens.ts`.

Imports:

```ts
import { and, desc, eq, lt, lte, notInArray } from 'drizzle-orm';
```

Replace the `await db.insert(tokenPairs).values({...});` statement in `issuePair` with:

```ts
await db.transaction(async (tx) => {
  await tx.insert(tokenPairs).values({
    applicationId: app.id,
    accessHash: sha256(accessToken),
    refreshHash: sha256(refreshToken),
    userId: input.userId,
    scope: input.scope,
    params: input.params,
    accessExpiresAt,
    refreshExpiresAt,
  });
  const keep = config.tokenPruningKeep;
  if (keep === null) return;
  const sameOwner = and(
    eq(tokenPairs.applicationId, app.id),
    eq(tokenPairs.userId, input.userId),
  );
  // Keep the newest `keep` pairs and every pair with a live access token. The subquery sees the
  // new row (same transaction); created_at is the transaction start, so id breaks ties.
  await tx
    .delete(tokenPairs)
    .where(
      and(
        sameOwner,
        lte(tokenPairs.accessExpiresAt, new Date(now)),
        notInArray(
          tokenPairs.id,
          tx
            .select({ id: tokenPairs.id })
            .from(tokenPairs)
            .where(sameOwner)
            .orderBy(desc(tokenPairs.createdAt), desc(tokenPairs.id))
            .limit(keep),
        ),
      ),
    );
});
```

`now` is the existing `const now = Date.now();` at the top of `issuePair`. Leave the `return tokenResponse(...)` as it is.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npm test -- test/integration/token-service.test.ts`
Expected: PASS, all tests in the file, old and new.

- [ ] **Step 6: Run the full suite, typecheck and lint**

Run: `npm test` then `npm run typecheck` then `npm run lint`
Expected: all PASS. `test/integration/event-delivery.test.ts` also calls `issuePair` through event auth; it must stay green.

- [ ] **Step 7: Commit**

```bash
git add src/tokens.ts test/helpers.ts test/integration/token-service.test.ts
git commit -m "feat(tokens): prune old expired token pairs on issue"
```

---

### Task 3.1: Indexes

**Files:**

- Modify: `src/schema.ts:25-55`
- Create (generated): `drizzle/0003_token_pair_indexes.sql`, `drizzle/meta/0003_snapshot.json`; modified: `drizzle/meta/_journal.json`

**Interfaces:**

- Produces: indexes `token_pairs_app_user_created_idx`, `token_pairs_created_at_idx`, `applications_portal_id_idx`.

- [ ] **Step 1: Declare the indexes** in `src/schema.ts`.

`applications` gets a third argument:

```ts
export const applications = pgTable(
  'applications',
  {
    // ... columns unchanged
  },
  (table) => [index('applications_portal_id_idx').on(table.portalId)],
);
```

`tokenPairs` index list becomes:

```ts
  (table) => [
    index('token_pairs_refresh_expires_at_idx').on(table.refreshExpiresAt),
    // Prune query in issuePair; ON DELETE CASCADE from applications.
    index('token_pairs_app_user_created_idx').on(
      table.applicationId,
      table.userId,
      table.createdAt,
    ),
    // Admin token list sort.
    index('token_pairs_created_at_idx').on(table.createdAt),
  ],
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -- --name token_pair_indexes`
Expected: `drizzle/0003_token_pair_indexes.sql` with exactly three `CREATE INDEX` statements:

```sql
CREATE INDEX "applications_portal_id_idx" ON "applications" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "token_pairs_app_user_created_idx" ON "token_pairs" USING btree ("application_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "token_pairs_created_at_idx" ON "token_pairs" USING btree ("created_at");
```

The order of the lines can differ. If the file has any other statement (for example `ALTER TABLE`), stop: the schema and the snapshot `0002` do not match. Do not edit the generated SQL by hand.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint`
Expected: PASS (`drizzle/` is in `.prettierignore`).

- [ ] **Step 4: Commit**

```bash
git add src/schema.ts drizzle/0003_token_pair_indexes.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): add indexes for token pruning, token list and cascades"
```

---

### Task 3.2: Migrations apply on the current schema and on a clean database

**Files:** none changed.

- [ ] **Step 1: Apply on the current schema.** The test database is at migration `0002` from earlier runs (if it is not, run `npm test` once on the base ref first). Run the suite; `test/global-setup.ts` applies `0003` only.

Run: `npm test`
Expected: PASS. Then confirm the indexes:

```bash
node -e "const pg=require('pg');const c=new pg.Client(process.env.TEST_DATABASE_URL||'postgres://b24auth:b24auth@localhost:5432/b24auth_test');c.connect().then(()=>c.query(\"select indexname from pg_indexes where indexname in ('token_pairs_app_user_created_idx','token_pairs_created_at_idx','applications_portal_id_idx') order by 1\")).then(r=>{console.log(r.rows);return c.end()})"
```

Expected: three rows.

- [ ] **Step 2: Apply on a clean database.** Drop the test database; `test/global-setup.ts` creates it again and runs `0000`..`0003`.

```bash
node -e "const pg=require('pg');const u=new URL(process.env.TEST_DATABASE_URL||'postgres://b24auth:b24auth@localhost:5432/b24auth_test');const n=u.pathname.slice(1);u.pathname='/postgres';const c=new pg.Client(u.toString());c.connect().then(()=>c.query('drop database if exists \"'+n+'\" with (force)')).then(()=>c.end())"
npm test
```

Expected: PASS. Run the index query from Step 1 again; expected three rows.

- [ ] **Step 3: Record the evidence** (command output of both runs) for Comet verify. No commit.

---

### Task 4.1: `docs/deployment.md`

**Files:**

- Modify: `docs/deployment.md:30-37`

- [ ] **Step 1: Add two rows** after the `TRUST_PROXY` row:

```markdown
| `TOKEN_PRUNING` | `true` | Optional, default `true`. Accepts only `true` or `false`. If `true`, each new token pair deletes the older pairs of the same application and user that are not among the newest `TOKEN_PRUNING_KEEP` pairs and whose access token has expired. A pair with a live access token stays. If `false`, each pair stays until its refresh token expires, as in the Bitrix24 cloud |
| `TOKEN_PRUNING_KEEP` | `5` | Optional, default `5`. A positive integer: the number of newest pairs that each application and user keep. The server reads it also when `TOKEN_PRUNING` is `false` |
```

- [ ] **Step 2: Replace the sentence** `If \`TRUST_PROXY\` has any other value, the server stops at start.` with:

```markdown
If `TRUST_PROXY` or `TOKEN_PRUNING` has any other value, or `TOKEN_PRUNING_KEEP` is not a positive
integer, the server stops at start with an error that names the variable.
```

- [ ] **Step 3: Commit**

```bash
git add docs/deployment.md
git commit -m "docs(deployment): document TOKEN_PRUNING and TOKEN_PRUNING_KEEP"
```

---

### Task 4.2: `README.md` and the five translations

**Files:**

- Modify: `README.md:122-131` (variable table in "Quick start") and the same table in `README.de.md`, `README.it.md`, `README.es.md`, `README.pt.md`, `README.ru.md` (also around line 122-131)

- [ ] **Step 1: Load `sepia-refactor`** (CLAUDE.md rule 4) and write the English text with it. Do not add facts beyond Task 4.1.

- [ ] **Step 2: Add two rows to `README.md`** after the `TRUST_PROXY` row (end each cell with a period, as the other rows do):

```markdown
| `TOKEN_PRUNING` | `true` | Optional, default `true`. Accepts only `true` or `false`. Each new token pair deletes the older pairs of the same application and user whose access token has expired, past the newest `TOKEN_PRUNING_KEEP`. |
| `TOKEN_PRUNING_KEEP` | `5` | Optional, default `5`. Positive integer: how many newest pairs each application and user keep. |
```

- [ ] **Step 3: Add the note** to `README.md` directly after the sentence that starts `` `BASE_URL`, `DATABASE_URL` and `PORTAL_ALLOWLIST` are required``:

```markdown
`TOKEN_PRUNING=false` keeps every pair until its refresh token expires, as the Bitrix24 cloud does.
```

- [ ] **Step 4: Make the same change in the five translations.** Same rows, same position, same note. Translate the prose in the table and the note; keep `TOKEN_PRUNING`, `TOKEN_PRUNING_KEEP`, `true`, `false`, `5` and "Bitrix24" as they are. Follow the wording style of the `TRUST_PROXY` row in each file (for example, German "Optional.", Russian "Необязательная.").

- [ ] **Step 5: Format and lint**

Run: `npx prettier --write README.md README.de.md README.it.md README.es.md README.pt.md README.ru.md` then `npm run lint`
Expected: PASS. Prettier realigns the table columns.

- [ ] **Step 6: Check parity.** Each file has the two new rows and one note:

```bash
grep -c "TOKEN_PRUNING" README.md README.de.md README.it.md README.es.md README.pt.md README.ru.md
```

Expected: the same count in all six files.

- [ ] **Step 7: Commit**

```bash
git add README.md README.de.md README.it.md README.es.md README.pt.md README.ru.md
git commit -m "docs(readme): document token pair pruning in all languages"
```

---

## Final check

- [ ] `npm test`, `npm run typecheck`, `npm run lint` all PASS.
- [ ] All seven ids in `docs/openspec/changes/token-pair-pruning/tasks.md` are checked.
