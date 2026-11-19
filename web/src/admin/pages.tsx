import { DataTable, type TableColumn } from './DataTable';

const PORTALS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'origin', label: 'Origin', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'applications', label: 'Applications', filter: 'none' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
];

const APPLICATIONS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'portal', label: 'Portal', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'title', label: 'Title', filter: 'text' },
  { key: 'redirectUri', label: 'Redirect URI', filter: 'text' },
  { key: 'scope', label: 'Scope', filter: 'text' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
];

const TOKENS: readonly TableColumn[] = [
  { key: 'id', label: 'ID', filter: 'id' },
  { key: 'portal', label: 'Portal', filter: 'text' },
  { key: 'application', label: 'Application', filter: 'text' },
  { key: 'clientId', label: 'client_id', filter: 'text' },
  { key: 'userId', label: 'User ID', filter: 'id' },
  { key: 'scope', label: 'Scope', filter: 'text' },
  { key: 'createdAt', label: 'Created at', filter: 'date' },
  { key: 'accessExpiresAt', label: 'Access expires at', filter: 'date' },
  { key: 'refreshExpiresAt', label: 'Refresh expires at', filter: 'date' },
  { key: 'state', label: 'State', filter: 'enum', values: ['active', 'expired'] },
];

const EVENTS: readonly TableColumn[] = [
  { key: 'day', label: 'Day', filter: 'date' },
  { key: 'outcome', label: 'Outcome', filter: 'enum', values: ['delivered', 'failed', 'dropped'] },
  { key: 'count', label: 'Count', filter: 'none' },
];

export function PortalsPage() {
  return (
    <>
      <h1 className="admin-title">Portals</h1>
      <DataTable endpoint="/portals" columns={PORTALS} />
    </>
  );
}

export function ApplicationsPage() {
  return (
    <>
      <h1 className="admin-title">Applications</h1>
      <DataTable endpoint="/applications" columns={APPLICATIONS} />
    </>
  );
}

export function TokensPage() {
  return (
    <>
      <h1 className="admin-title">Tokens</h1>
      <DataTable endpoint="/tokens" columns={TOKENS} />
    </>
  );
}

export function EventsPage() {
  return (
    <>
      <h1 className="admin-title">Event counters</h1>
      <DataTable endpoint="/events" columns={EVENTS} />
    </>
  );
}
