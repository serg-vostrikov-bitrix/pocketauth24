import { and, ilike, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';

export const PAGE_SIZE = 50;

export type FilterType = 'text' | 'id' | 'date' | 'enum' | 'none';

export type Column = {
  key: string; // query key and JSON field
  sql: SQL | AnyColumn; // Drizzle expression
  filter: FilterType;
  values?: readonly string[]; // enum values
};

export type ParsedQuery =
  | { ok: true; where: SQL | undefined; page: number; offset: number }
  | { ok: false; column: string };

// At most 9 digits: fits the int4 user_id column and every realistic bigserial id.
const ID_PATTERN = /^(0|[1-9]\d{0,8})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// Repeated keys arrive as arrays; only a single non-empty string counts.
function param(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function validDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

// A date-only "to" includes the whole day: compare with the start of the next day.
function upperBound(value: string): string {
  if (value.length !== 10) return value;
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Every value goes to PostgreSQL as a bound parameter.
export function parseQuery(
  columns: readonly Column[],
  query: Record<string, unknown>,
): ParsedQuery {
  const conditions: SQL[] = [];
  for (const column of columns) {
    const name = `filter[${column.key}]`;
    if (column.filter === 'text') {
      const value = param(query, name);
      if (value !== undefined) conditions.push(ilike(column.sql, `%${escapeLike(value)}%`));
    } else if (column.filter === 'id') {
      const value = param(query, name);
      if (value === undefined) continue;
      if (!ID_PATTERN.test(value)) return { ok: false, column: column.key };
      conditions.push(sql`${column.sql} = ${Number(value)}`);
    } else if (column.filter === 'enum') {
      const value = param(query, name);
      if (value === undefined) continue;
      if (!column.values?.includes(value)) return { ok: false, column: column.key };
      conditions.push(sql`${column.sql} = ${value}`);
    } else if (column.filter === 'date') {
      const from = param(query, `filter[${column.key}.from]`);
      const to = param(query, `filter[${column.key}.to]`);
      if ((from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to))) {
        return { ok: false, column: column.key };
      }
      if (from !== undefined) conditions.push(sql`${column.sql} >= ${from}`);
      if (to !== undefined) conditions.push(sql`${column.sql} < ${upperBound(to)}`);
    }
  }
  const requested = Number(param(query, 'page') ?? '1');
  const page = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;
  return {
    ok: true,
    where: conditions.length > 0 ? and(...conditions) : undefined,
    page,
    offset: (page - 1) * PAGE_SIZE,
  };
}

// Every column of this module is a PostgreSQL column or SQL expression, so the map is a valid
// select list for the pg-core query builder.
export function selection(columns: readonly Column[]): SelectedFields {
  return Object.fromEntries(columns.map((column) => [column.key, column.sql])) as SelectedFields;
}
