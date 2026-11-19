import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiGet, apiSend, type Role } from './api';

type UserRow = { id: number; login: string; role: Role; createdAt: string };
type Shown = { login: string; password: string };

const ERRORS: Record<string, string> = {
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
  const passwordRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    apiGet<UserRow[]>('/users').then(setUsers, () =>
      setError('The user list could not be loaded.'),
    );
  }, []);
  useEffect(load, [load]);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    apiSend<{ id: number; login: string; password: string }>('POST', '/users', {
      login: newLogin,
    }).then(
      (created) => {
        setShown({ login: created.login, password: created.password });
        setNewLogin('');
        load();
      },
      (err: unknown) => setError(message(err)),
    );
  };

  const reset = (user: UserRow): void => {
    setError(null);
    apiSend<{ password: string }>('POST', `/users/${user.id}/password`).then(
      ({ password }) => setShown({ login: user.login, password }),
      (err: unknown) => setError(message(err)),
    );
  };

  const remove = (user: UserRow): void => {
    if (!window.confirm(`Delete the viewer "${user.login}"? The viewer is logged out at once.`))
      return;
    setError(null);
    apiSend('DELETE', `/users/${user.id}`).then(load, (err: unknown) => setError(message(err)));
  };

  const copy = (): void => {
    if (!shown) return;
    const selectText = (): void => {
      // Fallback for a non-secure context: select the text so the user can copy it by hand.
      if (passwordRef.current) window.getSelection()?.selectAllChildren(passwordRef.current);
    };
    if (!navigator.clipboard) {
      selectText();
      return;
    }
    navigator.clipboard.writeText(shown.password).then(() => setCopied(true), selectText);
  };

  const close = (): void => {
    setShown(null);
    setCopied(false);
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
        <button type="submit" className="admin-button">
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
                          onClick={() => reset(user)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
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
