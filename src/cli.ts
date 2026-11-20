import { parseArgs } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { hashPassword } from './admin/password.js';
import { LOGIN_PATTERN, setSuperuser } from './admin/users.js';
import { MIN_PASSWORD_LENGTH, requiredEnv } from './config.js';
import { createDb, type Db } from './db.js';
import { listCatalog, removeCatalogEntry, upsertCatalogEntry } from './marketplace.js';
import { normalizeScope, sha256 } from './tokens.js';

const USAGE = [
  'Usage:',
  '  node dist/cli.js superuser set-password [--login <name>] [--password-stdin]',
  '  node dist/cli.js marketplace add --client-id <id> --title <title> --scope <scope> [--secret-stdin]',
  '  node dist/cli.js marketplace list',
  '  node dist/cli.js marketplace remove --client-id <id>',
  '',
  'marketplace add with a known client_id replaces its secret, title and scope.',
  'A new scope reaches an installed portal after its next application.install.',
  'marketplace remove deletes all installs of the application and all their tokens.',
  'The portal installs the application again when a user opens it after a new add.',
].join('\n');

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      login: { type: 'string' },
      'password-stdin': { type: 'boolean' },
      'client-id': { type: 'string' },
      title: { type: 'string' },
      scope: { type: 'string' },
      'secret-stdin': { type: 'boolean' },
    },
  });
}

type Values = ReturnType<typeof parseCli>['values'];

async function readStdinLine(): Promise<string> {
  let data = '';
  // Without an encoding, each chunk is decoded alone and a split multibyte character breaks.
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    data += chunk as string;
    const end = data.indexOf('\n');
    if (end >= 0) return data.slice(0, end).replace(/\r$/, '');
  }
  return data.replace(/\r$/, '');
}

// Input after Enter in one chunk (a paste of two lines) goes to the next prompt.
let pendingInput = '';

// Raw mode: the terminal echoes nothing. Enter ends the input, Backspace deletes one character,
// Ctrl+C exits with 130. Escape sequences (arrows and other special keys) are ignored.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let value = '';
    // none: normal input; esc: after ESC; seq: inside a CSI or SS3 sequence.
    let escape: 'none' | 'esc' | 'seq' = 'none';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const onData = (chunk: string): boolean => {
      const chars = [...chunk];
      for (const [i, ch] of chars.entries()) {
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (escape === 'esc') {
          escape = ch === '[' || ch === 'O' ? 'seq' : 'none';
          continue;
        }
        if (escape === 'seq') {
          // A final byte is in the range "@" to "~".
          if (ch >= '@' && ch <= '~') escape = 'none';
          continue;
        }
        if (ch === '\u001b') {
          escape = 'esc';
          continue;
        }
        if (ch === '\r' || ch === '\n') {
          let rest = chars.slice(i + 1).join('');
          if (ch === '\r' && rest.startsWith('\n')) rest = rest.slice(1);
          pendingInput = rest;
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(value);
          return true;
        }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
      return false;
    };
    const pending = pendingInput;
    pendingInput = '';
    if (pending && onData(pending)) return;
    stdin.on('data', onData);
    stdin.resume();
  });
}

// Runs the migrations, then `run`. Never prints err.message or the stack: a Drizzle error holds
// the query parameters, and the parameters of a write hold a password hash or a secret hash.
async function withDb(run: (db: Db) => Promise<number>): Promise<number> {
  const { db, pool } = createDb(requiredEnv(process.env, 'DATABASE_URL'));
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    return await run(db);
  } catch (err) {
    const reason = ((err as Error).cause as Error | undefined)?.message ?? 'database error';
    console.error(`The database operation failed: ${reason}. Nothing changed.`);
    return 1;
  } finally {
    await pool.end();
  }
}

async function setPassword(values: Values): Promise<number> {
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
  const passwordHash = await hashPassword(password);
  return withDb(async (db) => {
    const result = await setSuperuser(db, values.login, passwordHash);
    if (!result.saved) {
      console.error(`The login "${result.login}" belongs to a viewer. Nothing changed.`);
      return 1;
    }
    console.log(`Superuser "${result.login}" saved.`);
    return 0;
  });
}

async function marketplaceAdd(values: Values): Promise<number> {
  const clientId = values['client-id'];
  const { title } = values;
  if (!clientId || !title || !values.scope) {
    console.error(`marketplace add needs --client-id, --title and --scope.\n${USAGE}`);
    return 1;
  }
  // A local client_id on the same portal would collide with the install row.
  if (clientId.startsWith('local.')) {
    console.error('A Marketplace client_id cannot start with "local.". Nothing changed.');
    return 1;
  }
  let secret: string;
  if (values['secret-stdin']) {
    secret = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) {
      console.error('No terminal is attached. Pipe the client secret and use --secret-stdin.');
      return 2;
    }
    secret = await promptHidden('Client secret: ');
    const again = await promptHidden('Repeat the client secret: ');
    if (secret !== again) {
      console.error('The secrets do not match. Nothing changed.');
      return 1;
    }
  }
  if (secret.length === 0) {
    console.error('The client secret is empty. Nothing changed.');
    return 1;
  }
  const scope = normalizeScope(values.scope);
  return withDb(async (db) => {
    await upsertCatalogEntry(db, { clientId, secretHash: sha256(secret), title, scope });
    console.log(`Catalog entry "${clientId}" saved.`);
    return 0;
  });
}

async function marketplaceList(): Promise<number> {
  return withDb(async (db) => {
    for (const entry of await listCatalog(db)) {
      console.log([entry.clientId, entry.title, entry.scope].join('\t'));
    }
    return 0;
  });
}

async function marketplaceRemove(values: Values): Promise<number> {
  const clientId = values['client-id'];
  if (!clientId) {
    console.error(`marketplace remove needs --client-id.\n${USAGE}`);
    return 1;
  }
  return withDb(async (db) => {
    if (!(await removeCatalogEntry(db, clientId))) {
      console.error(`There is no catalog entry "${clientId}". Nothing changed.`);
      return 1;
    }
    console.log('Removed');
    return 0;
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
  switch (positionals.join(' ')) {
    case 'superuser set-password':
      return setPassword(values);
    case 'marketplace add':
      return marketplaceAdd(values);
    case 'marketplace list':
      return marketplaceList();
    case 'marketplace remove':
      return marketplaceRemove(values);
    default:
      console.error(USAGE);
      return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
