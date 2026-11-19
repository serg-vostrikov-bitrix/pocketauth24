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
