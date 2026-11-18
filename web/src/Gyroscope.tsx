// Decoration only; the status pills carry the meaning.
export function Gyroscope({ state }: { state: 'ok' | 'error' }) {
  return (
    <div className={state === 'error' ? 'gyro gyro--error' : 'gyro'} aria-hidden="true">
      <div className="gyro-ring gyro-ring--1" />
      <div className="gyro-ring gyro-ring--2" />
      <div className="gyro-ring gyro-ring--3" />
      <div className="gyro-ring gyro-ring--4" />
      <div className="gyro-core" />
    </div>
  );
}
