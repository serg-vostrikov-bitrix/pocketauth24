import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// 128 * N * r = 32 MiB; Node's default maxmem (32 MiB) is too tight for it.
const MAXMEM = 64 * 1024 * 1024;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const GENERATED_LENGTH = 20;

// node:crypto has no promise form of scrypt with options; this is the smallest wrapper.
function scryptAsync(
  plain: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(plain, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (![n, r, p].every(Number.isSafeInteger) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  try {
    const actual = await scryptAsync(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Login verifies against this hash when the login does not exist, so the response time does
// not reveal valid logins.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function generatePassword(): string {
  return Array.from({ length: GENERATED_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    '',
  );
}
