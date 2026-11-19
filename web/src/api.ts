// Declared by hand; test/integration/status.test.ts checks the server side of these names.
export type Outcome = 'delivered' | 'failed' | 'dropped';
export type EventTotals = Record<Outcome, number>;
export type Status = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  version: string;
  portals: number | null;
  applications: number | null;
  activeTokenPairs: number | null;
  events: { today: EventTotals; last7Days: EventTotals } | null;
};

export async function fetchStatus(): Promise<Status> {
  const res = await fetch('/api/status', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Status;
}
