import { parseArgs } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { hashPassword } from './admin/password.js';
import { LOGIN_PATTERN, setSuperuser } from './admin/users.js';
import { MIN_PASSWORD_LENGTH, requiredEnv } from './config.js';
import { createDb } from './db.js';

const USAGE = 'Usage: node dist/cli.js superuser set-password [--login <name>] [--password-stdin]';

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { login: { type: 'string' }, 'password-stdin': { type: 'boolean' } },
  });
}

async function readStdinLine(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += String(chunk);
    const end = data.indexOf('\n');
    if (end >= 0) return data.slice(0, end).replace(/\r$/, '');
  }
  return data.replace(/\r$/, '');
}

// Raw mode: the terminal echoes nothing. Enter ends the input, Backspace deletes one character,
// Ctrl+C exits with 130.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(argv: string[]): Promise<number> {
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = args;
  if (positionals.join(' ') !== 'superuser set-password') {
    console.error(USAGE);
    return 1;
  }
  if (values.login !== undefined && !LOGIN_PATTERN.test(values.login)) {
    console.error('The login must have 3 to 64 characters: letters, digits, ".", "_" or "-".');
    return 1;
  }

  let password: string;
  if (values['password-stdin']) {
    password = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) {
      console.error('No terminal is attached. Pipe the password and use --password-stdin.');
      return 2;
    }
    password = await promptHidden('New password: ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('The passwords do not match. Nothing changed.');
      return 1;
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }

  const { db, pool } = createDb(requiredEnv(process.env, 'DATABASE_URL'));
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    const result = await setSuperuser(db, values.login, await hashPassword(password));
    if (!result.saved) {
      console.error(`The login "${result.login}" belongs to a viewer. Nothing changed.`);
      return 1;
    }
    console.log(`Superuser "${result.login}" saved.`);
    return 0;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
