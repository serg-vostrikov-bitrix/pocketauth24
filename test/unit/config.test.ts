import { expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
  BASE_URL: 'https://a.test',
  DATABASE_URL: 'postgres://x',
  PORTAL_ALLOWLIST: 'p.test',
};
const trustProxy = (value?: string) => loadConfig({ ...base, TRUST_PROXY: value }).trustProxy;

it('TRUST_PROXY is false when unset or "false" and true when "true"', () => {
  expect(trustProxy()).toBe(false);
  expect(trustProxy('false')).toBe(false);
  expect(trustProxy('true')).toBe(true);
});

it.each(['TRUE', 'yes', '1'])('TRUST_PROXY=%j throws at boot', (value) => {
  expect(() => trustProxy(value)).toThrow(/TRUST_PROXY/);
});
