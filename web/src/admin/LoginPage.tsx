import { useState, type FormEvent } from 'react';
import { Gyroscope } from '../Gyroscope';
import { ApiError, apiSend, type AdminUser, type ApiErrorBody } from './api';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong login or password.',
  too_many_attempts: 'Too many failed attempts. Try again in 15 minutes.',
};

export function LoginPage({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    apiSend<AdminUser>('POST', '/login', { login, password })
      .then(onLogin, (err: unknown) => {
        setError(err instanceof ApiError ? err.body : { error: 'network' });
        setPassword('');
      })
      .finally(() => setBusy(false));
  };

  return (
    <main className="admin-login">
      <Gyroscope state={error ? 'error' : 'ok'} />
      <h1 className="admin-login-title">PocketAuth24 admin</h1>
      {error?.error === 'no_superuser' && (
        <div className="admin-notice" role="alert">
          <p>No superuser exists yet. Run this command on the server, then log in:</p>
          <pre>
            <code>{error.hint}</code>
          </pre>
        </div>
      )}
      <form className="admin-login-form" onSubmit={submit}>
        <label>
          Login
          <input
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && error.error !== 'no_superuser' && (
          <p className="admin-error" role="alert">
            {MESSAGES[error.error] ?? 'Login failed. Try again.'}
          </p>
        )}
        <button type="submit" className="admin-button" disabled={busy}>
          Log in
        </button>
      </form>
    </main>
  );
}
