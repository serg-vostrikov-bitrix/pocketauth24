import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { escapeLike, parseQuery, type Column } from '../../src/admin/filters.js';

const COLUMNS: readonly Column[] = [
  { key: 'id', sql: sql`id`, filter: 'id' },
  { key: 'name', sql: sql`name`, filter: 'text' },
  { key: 'state', sql: sql`state`, filter: 'enum', values: ['active', 'expired'] },
  { key: 'createdAt', sql: sql`created_at`, filter: 'date' },
];

it('escapeLike escapes backslash, percent and underscore', () => {
  expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
});

it('No filters give no condition and page 1', () => {
  expect(parseQuery(COLUMNS, {})).toEqual({ ok: true, where: undefined, page: 1, offset: 0 });
});

it('Unknown keys and empty values are ignored', () => {
  const parsed = parseQuery(COLUMNS, { 'filter[other]': 'x', 'filter[name]': '', foo: 'bar' });
  expect(parsed).toMatchObject({ ok: true, where: undefined });
});

it('Valid filters give a condition', () => {
  const parsed = parseQuery(COLUMNS, {
    'filter[id]': '5',
    'filter[name]': 'x',
    'filter[state]': 'active',
    'filter[createdAt.from]': '2026-01-01',
    'filter[createdAt.to]': '2026-01-02T10:00:00Z',
  });
  expect(parsed.ok).toBe(true);
  expect(parsed.ok && parsed.where).toBeTruthy();
});

it('Invalid id, enum or date values name the column', () => {
  expect(parseQuery(COLUMNS, { 'filter[id]': 'abc' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[id]': '1.5' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[state]': 'old' })).toEqual({ ok: false, column: 'state' });
  expect(parseQuery(COLUMNS, { 'filter[createdAt.from]': 'yesterday' })).toEqual({
    ok: false,
    column: 'createdAt',
  });
});

it('The page is 1-based and invalid pages fall back to 1', () => {
  expect(parseQuery(COLUMNS, { page: '3' })).toMatchObject({ page: 3, offset: 100 });
  expect(parseQuery(COLUMNS, { page: '0' })).toMatchObject({ page: 1, offset: 0 });
  expect(parseQuery(COLUMNS, { page: 'x' })).toMatchObject({ page: 1, offset: 0 });
});

it('Id values with more than 9 digits or signs name the column', () => {
  expect(parseQuery(COLUMNS, { 'filter[id]': '1234567890' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[id]': '-1' })).toEqual({ ok: false, column: 'id' });
  expect(parseQuery(COLUMNS, { 'filter[id]': '999999999' })).toMatchObject({ ok: true });
});

it('A page beyond the safe integer range falls back to 1', () => {
  expect(parseQuery(COLUMNS, { page: '99999999999999999999' })).toMatchObject({
    page: 1,
    offset: 0,
  });
  expect(parseQuery(COLUMNS, { page: '-2' })).toMatchObject({ page: 1, offset: 0 });
});
