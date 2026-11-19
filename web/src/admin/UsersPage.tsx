import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiGet, apiSend, type Role } from './api';

type UserRow = { id: number; login: string; role: Role; createdAt: string };
type Shown = { login: string; password: string };

const ERRORS: Record<string, string> = {
  not_found: 'This user no longer exists.',
  forbidden: 'This action is not allowed.',
  invalid_login: 'Use 3 to 64 characters: letters, digits, ".", "_" or "-".',
  login_taken: 'This login already exists.',
};

function message(err: unknown): string {
  return (err instanceof ApiError && ERRORS[err.body.error]) || 'The action failed. Try again.';
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [newLogin, setNewLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const passwordRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    apiGet<UserRow[]>('/users').then(setUsers, () =>
      setError('The user list could not be loaded.'),
    );
  }, []);
  useEffect(load, [load]);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    apiSend<{ id: number; login: string; password: string }>('POST', '/users', { login: newLogin })
      .then(
        (created) => {
          setShown({ login: created.login, password: created.password });
          setNewLogin('');
          load();
        },
        (err: unknown) => setError(message(err)),
      )
      .finally(() => setBusy(false));
  };

  const reset = (user: UserRow): void => {
    if (busy) return;
    setError(null);
    setBusy(true);
    apiSend<{ password: string }>('POST', `/users/${user.id}/password`)
      .then(
        ({ password }) => setShown({ login: user.login, password }),
        (err: unknown) => setError(message(err)),
      )
      .finally(() => setBusy(false));
  };

  const remove = (user: UserRow): void => {
    if (busy) return;
    if (!window.confirm(`Delete the viewer "${user.login}"? The viewer is logged out at once.`))
      return;
    setError(null);
    setBusy(true);
    apiSend('DELETE', `/users/${user.id}`)
      .then(load, (err: unknown) => {
        setError(message(err));
        load();
      })
      .finally(() => setBusy(false));
  };

  const copy = (): void => {
    if (!shown) return;
    const selectManually = (): void => {
      // Fallback for a non-secure context: select the text so the user can copy it by hand.
      if (passwordRef.current) window.getSelection()?.selectAllChildren(passwordRef.current);
      setHint(true);
    };
    if (!navigator.clipboard) {
      selectManually();
      return;
    }
    navigator.clipboard.writeText(shown.password).then(() => setCopied(true), selectManually);
  };

  const close = (): void => {
    setShown(null);
    setCopied(false);
    setHint(false);
  };

  return (
    <>
      <h1 className="admin-title">Users</h1>
      <form className="admin-inline-form" onSubmit={create}>
        <input
          aria-label="Login of the new viewer"
          placeholder="Login"
          value={newLogin}
          onChange={(e) => setNewLogin(e.target.value)}
          required
        />
        <button type="submit" className="admin-button" disabled={busy}>
          New viewer
        </button>
      </form>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Login</th>
                <th scope="col">Role</th>
                <th scope="col">Created at</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => (
                <tr key={user.id}>
                  <td title={user.login}>{user.login}</td>
                  <td>{user.role}</td>
                  <td>{`${user.createdAt.slice(0, 19).replace('T', ' ')} UTC`}</td>
                  <td className="admin-actions">
                    {user.role === 'viewer' && (
                      <>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          disabled={busy}
                          onClick={() => reset(user)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          disabled={busy}
                          onClick={() => remove(user)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {shown && (
        <div className="admin-dialog-backdrop">
          <div
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-dialog-title"
          >
            <h2 id="admin-dialog-title">Password for {shown.login}</h2>
            <code className="admin-password" ref={passwordRef}>
              {shown.password}
            </code>
            <p>This password is shown once.</p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              {hint && <span className="admin-hint">Press Ctrl+C to copy.</span>}
              <button type="button" className="admin-button admin-button--ghost" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
