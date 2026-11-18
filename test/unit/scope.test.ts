import { describe, expect, it } from 'vitest';
import { intersectScope } from '../../src/tokens.js';

describe('intersectScope', () => {
  it.each([
    ['empty request takes the app scope', '', 'crm,user', 'crm,user'],
    ['subset', 'crm', 'crm,user', 'crm'],
    ['superset is cut to the app scope', 'crm,user,disk', 'crm,user', 'crm,user'],
    ['spaces are trimmed', ' crm , user ', 'crm, user', 'crm,user'],
    ['disjoint gives an empty scope', 'disk', 'crm', ''],
  ])('%s', (_name, requested, appScope, expected) => {
    expect(intersectScope(requested, appScope)).toBe(expected);
  });
});
