import { useEffect, useState } from 'react';
import { fetchStatus, type EventTotals, type Status } from './api';
import { Gyroscope } from './Gyroscope';
import { formatCount, StatCard } from './StatCard';
import { StatusPill } from './StatusPill';

const REFRESH_MS = 30_000;

function failedAndDropped(totals: EventTotals): string {
  return `${formatCount(totals.failed)} failed · ${formatCount(totals.dropped)} dropped`;
}

export function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      fetchStatus().then(
        (next) => {
          if (!active) return;
          setStatus(next);
          setReachable(true);
        },
        // Keep the last counts; the service and database pills change.
        () => {
          if (active) setReachable(false);
        },
      );
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const service = reachable ? (status?.status ?? 'loading') : 'unreachable';
  const database = reachable ? (status?.database ?? 'loading') : 'unknown';
  const events = status?.events ?? null;

  const gyroState = !reachable || status?.status === 'degraded' ? 'error' : 'ok';

  return (
    <main className="page">
      <header className="hero">
        <Gyroscope state={gyroState} />
        <h1 className="title">b24auth-server</h1>
        <div className="pills">
          <StatusPill label="Service" value={service} />
          <StatusPill label="Database" value={database} />
          {status && <span className="version">v{status.version}</span>}
        </div>
      </header>
      <section className="cards">
        <StatCard index={0} label="Portals" value={status?.portals ?? null} />
        <StatCard index={1} label="Local applications" value={status?.applications ?? null} />
        <StatCard index={2} label="Active token pairs" value={status?.activeTokenPairs ?? null} />
        <StatCard
          index={3}
          label="Events delivered today"
          value={events?.today.delivered ?? null}
          detail={events ? failedAndDropped(events.today) : undefined}
        />
        <StatCard
          index={4}
          label="Events delivered, 7 days"
          value={events?.last7Days.delivered ?? null}
          detail={events ? failedAndDropped(events.last7Days) : undefined}
        />
      </section>
    </main>
  );
}
