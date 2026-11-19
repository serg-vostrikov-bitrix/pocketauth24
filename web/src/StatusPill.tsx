type Tone = 'ok' | 'error' | 'muted';

function toneOf(value: string): Tone {
  if (value === 'ok') return 'ok';
  if (value === 'loading' || value === 'unknown') return 'muted';
  return 'error';
}

export function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className={`pill pill--${toneOf(value)}`}>
      <span className="pill-dot" />
      {label}: {value}
    </span>
  );
}
