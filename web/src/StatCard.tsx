import type { CSSProperties } from 'react';

const numberFormat = new Intl.NumberFormat();

export function formatCount(value: number | null): string {
  return value === null ? '—' : numberFormat.format(value);
}

export function StatCard(props: {
  index: number;
  label: string;
  value: number | null;
  detail?: string;
}) {
  const text = formatCount(props.value);
  return (
    <div className="card" style={{ '--i': props.index } as CSSProperties}>
      <div className="card-label">{props.label}</div>
      {/* A new key remounts the value, so a changed value fades in. */}
      <div key={text} className="card-value">
        {text}
      </div>
      {props.detail && <div className="card-detail">{props.detail}</div>}
    </div>
  );
}
