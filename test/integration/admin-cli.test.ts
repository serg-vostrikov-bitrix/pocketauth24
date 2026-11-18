import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { verifyPassword } from '../../src/admin/password.js';
import { createDb, type Db } from '../../src/db.js';
import { adminSessions, adminUsers } from '../../src/schema.js';
import { TEST_DATABASE_URL, truncateAll } from '../helpers.js';

type CliResult = { code: number | null; stdout: string; stderr: string };

// Spawned without a TTY: the CLI sees process.stdin.isTTY as undefined.
function runCli(args: string[], stdin = ''): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
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
