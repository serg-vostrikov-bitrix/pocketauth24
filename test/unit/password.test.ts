import { describe, expect, it } from 'vitest';
import {
  DUMMY_HASH,
  generatePassword,
  hashPassword,
  verifyPassword,
} from '../../src/admin/password.js';

describe('password hashing', () => {
  it('verifies the password it hashed and rejects another one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
  });

  it('gives different stored values for equal passwords', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('returns false for a malformed stored value', async () => {
    for (const bad of [
      '',
      'plain',
      'scrypt$1$2$3',
      'bcrypt$32768$8$1$c2FsdA==$aGFzaA==',
      'scrypt$x$8$1$c2FsdA==$aGFzaA==',
      'scrypt$3$8$1$c2FsdA==$aGFzaA==',
    ]) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
  });

  it('DUMMY_HASH is a valid hash that matches no ordinary password', async () => {
    expect(DUMMY_HASH).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });

  it('generates 20 characters from [A-Za-z0-9]', () => {
    const values = new Set(Array.from({ length: 50 }, generatePassword));
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(values.size).toBe(50);
  });
});
