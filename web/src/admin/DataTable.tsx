import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, apiGet } from './api';

export type TableColumn = {
  key: string;
  label: string;
  filter: 'text' | 'id' | 'date' | 'enum' | 'none';
  values?: readonly string[];
};

type PageData = { rows: Record<string, unknown>[]; total: number; page: number; pageSize: number };

const DEBOUNCE_MS = 300;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return ISO_DATE_TIME.test(text) ? `${text.slice(0, 19).replace('T', ' ')} UTC` : text;
}

// Local draft; the URL changes 300 ms after the last keystroke.
function DebouncedInput(props: {
  label: string;
  value: string;
  numeric: boolean;
  onCommit: (value: string) => void;
}) {
  const { label, value, numeric, onCommit } = props;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onCommit(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // onCommit changes on every render; the timer must restart only on new input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);
  return (
    <input
      aria-label={label}
      inputMode={numeric ? 'numeric' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function FilterCell(props: {
  column: TableColumn;
  params: URLSearchParams;
  onChange: (name: string, value: string) => void;
}) {
  const { column, params, onChange } = props;
  const name = `filter[${column.key}]`;
  if (column.filter === 'text' || column.filter === 'id') {
    return (
      <DebouncedInput
        label={`Filter by ${column.label}`}
        value={params.get(name) ?? ''}
        numeric={column.filter === 'id'}
        onCommit={(value) => onChange(name, value)}
      />
    );
  }
  if (column.filter === 'enum') {
    return (
      <select
        aria-label={`Filter by ${column.label}`}
        value={params.get(name) ?? ''}
        onChange={(e) => onChange(name, e.target.value)}
      >
        <option value="">All</option>
        {column.values?.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  }
  if (column.filter === 'date') {
    const from = `filter[${column.key}.from]`;
    const to = `filter[${column.key}.to]`;
    return (
      <div className="admin-date-range">
        <input
          type="date"
          aria-label={`${column.label} from`}
          value={params.get(from) ?? ''}
          onChange={(e) => onChange(from, e.target.value)}
        />
        <input
          type="date"
          aria-label={`${column.label} to`}
          value={params.get(to) ?? ''}
          onChange={(e) => onChange(to, e.target.value)}
        />
      </div>
    );
  }
  return null;
}

export function DataTable({
  endpoint,
  columns,
}: {
  endpoint: string;
  columns: readonly TableColumn[];
}) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = params.toString();

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<PageData>(endpoint, new URLSearchParams(query))
      .then(
        (next) => {
          if (!active) return;
          setData(next);
          setError(null);
        },
        (err: unknown) => {
          if (!active) return;
          setData(null);
          const column = err instanceof ApiError ? err.body.column : undefined;
          setError(
            column ? `Invalid filter value in "${column}".` : 'The data could not be loaded.',
          );
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, query]);

  // A filter change resets the page to 1.
  const setFilter = (name: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const setPage = (page: number): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(page));
      return next;
    });
  };

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={loading ? 'admin-table-wrap admin-table-wrap--loading' : 'admin-table-wrap'}>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
            <tr className="admin-filter-row">
              {columns.map((column) => (
                <th key={column.key}>
                  <FilterCell column={column} params={params} onChange={setFilter} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row, index) => (
              <tr key={`${page}-${index}`}>
                {columns.map((column) => {
                  const text = display(row[column.key]);
                  return (
                    <td key={column.key} title={text}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="admin-empty">
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-table-footer">
        <span role="status">
          {error ??
            (loading
              ? 'Loading…'
              : `${data?.total ?? 0} ${data?.total === 1 ? 'row' : 'rows'} · page ${page} of ${pages}`)}
        </span>
        <div className="admin-pager">
          <button
            type="button"
            className="admin-button admin-button--ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="admin-button admin-button--ghost"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
