import { spawn } from 'node:child_process';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { verifyPassword } from '../../src/admin/password.js';
import { createDb, type Db } from '../../src/db.js';
import { adminSessions, adminUsers } from '../../src/schema.js';
import { DEAD_DATABASE_URL, TEST_DATABASE_URL, truncateAll } from '../helpers.js';

type CliResult = { code: number | null; stdout: string; stderr: string };

// Spawned without a TTY: the CLI sees process.stdin.isTTY as undefined.
// An array of buffers goes to stdin as separate writes with a pause between them.
function runCli(
  args: string[],
  stdin: string | Buffer[] = '',
  databaseUrl = TEST_DATABASE_URL,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (typeof stdin === 'string') {
      child.stdin.end(stdin);
      return;
    }
    void (async () => {
      for (const [i, part] of stdin.entries()) {
        // The CLI starts in about one second; the pause lets it read each part alone.
        if (i > 0) await new Promise((r) => setTimeout(r, 3000));
        child.stdin.write(part);
      }
      child.stdin.end();
    })();
  });
}

const SET = ['superuser', 'set-password'];
const PASSWORD = 'first-password-123';
const NEW_PASSWORD = 'second-password-456';

let db: Db;
let close: () => Promise<void>;
beforeAll(() => {
  const created = createDb(TEST_DATABASE_URL);
  db = created.db;
  close = () => created.pool.end();
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await truncateAll(db);
});

async function superusers() {
  return db.select().from(adminUsers).where(eq(adminUsers.role, 'superuser'));
}

it(
  'Creates the superuser from stdin and never prints the password',
  { timeout: 20_000 },
  async () => {
    const res = await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('Superuser "admin" saved.');
    expect(res.stdout + res.stderr).not.toContain(PASSWORD);
    const [user] = await superusers();
    expect(user.login).toBe('admin');
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
  },
);

it(
  'A multibyte character split across stdin chunks stays intact',
  { timeout: 20_000 },
  async () => {
    const password = 'пароль-пароль-123';
    const bytes = Buffer.from(`${password}\n`, 'utf8');
    // Byte 1 is in the middle of the first two-byte Cyrillic character.
    const res = await runCli(
      [...SET, '--password-stdin'],
      [bytes.subarray(0, 1), bytes.subarray(1)],
    );
    expect(res.code).toBe(0);
    const [user] = await superusers();
    expect(await verifyPassword(password, user.passwordHash)).toBe(true);
  },
);

it(
  'A second run replaces the hash and the login and deletes the sessions',
  { timeout: 30_000 },
  async () => {
    await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`);
    const [before] = await superusers();
    await db.insert(adminSessions).values({
      idHash: 'b'.repeat(64),
      userId: before.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await runCli([...SET, '--login', 'root', '--password-stdin'], `${NEW_PASSWORD}\n`);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('Superuser "root" saved.');
    const [after] = await superusers();
    expect(after.id).toBe(before.id);
    expect(after.login).toBe('root');
    expect(await verifyPassword(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(await db.$count(adminSessions)).toBe(0);
  },
);

it('Without --login a second run keeps the current login', { timeout: 30_000 }, async () => {
  await runCli([...SET, '--login', 'root', '--password-stdin'], `${PASSWORD}\n`);
  const res = await runCli([...SET, '--password-stdin'], `${NEW_PASSWORD}\n`);
  expect(res.stdout.trim()).toBe('Superuser "root" saved.');
  const [user] = await superusers();
  expect(user.login).toBe('root');
});

it('A short password exits with 1 and changes nothing', { timeout: 20_000 }, async () => {
  const res = await runCli([...SET, '--password-stdin'], 'short-pass\n');
  expect(res.code).toBe(1);
  expect(await db.$count(adminUsers)).toBe(0);
});

it('The --password flag is rejected', { timeout: 20_000 }, async () => {
  const res = await runCli([...SET, '--password', PASSWORD]);
  expect(res.code).toBe(1);
  expect(await db.$count(adminUsers)).toBe(0);
});

it('The login of a viewer exits with 1 and changes nothing', { timeout: 20_000 }, async () => {
  await db.insert(adminUsers).values({ login: 'alice', passwordHash: 'x', role: 'viewer' });
  const res = await runCli([...SET, '--login', 'alice', '--password-stdin'], `${PASSWORD}\n`);
  expect(res.code).toBe(1);
  expect(await superusers()).toHaveLength(0);
});

it(
  'Without a TTY and without --password-stdin the command exits with 2',
  { timeout: 20_000 },
  async () => {
    const res = await runCli(SET);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--password-stdin');
  },
);

it(
  'A failed write exits with 1 and never prints the password hash',
  { timeout: 20_000 },
  async () => {
    // The trigger makes the INSERT fail after the CLI has computed the hash.
    await db.execute(sql`
      create or replace function admin_cli_test_reject() returns trigger language plpgsql as $$
      begin raise exception 'admin_cli_test_reject'; end $$`);
    await db.execute(sql`
      create trigger admin_cli_test_reject before insert or update on admin_users
      for each row execute function admin_cli_test_reject()`);
    try {
      const res = await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('admin_cli_test_reject');
      expect(res.stdout + res.stderr).not.toContain('scrypt$');
      expect(res.stderr).not.toMatch(/\n\s+at /);
    } finally {
      await db.execute(sql`drop trigger if exists admin_cli_test_reject on admin_users`);
      await db.execute(sql`drop function if exists admin_cli_test_reject()`);
    }
  },
);

it(
  'An unreachable database exits with 1 without a stack or the DATABASE_URL',
  { timeout: 20_000 },
  async () => {
    const res = await runCli([...SET, '--password-stdin'], `${PASSWORD}\n`, DEAD_DATABASE_URL);
    expect(res.code).toBe(1);
    expect(res.stderr).not.toContain('b24auth:b24auth');
    expect(res.stderr).not.toMatch(/\n\s+at /);
  },
);
