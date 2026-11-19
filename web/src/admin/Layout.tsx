import { NavLink, Outlet } from 'react-router';
import { apiSend, type AdminUser } from './api';

const LINKS: readonly (readonly [string, string])[] = [
  ['portals', 'Portals'],
  ['applications', 'Applications'],
  ['tokens', 'Tokens'],
  ['events', 'Event counters'],
];

export function Layout({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const links = user.role === 'superuser' ? [...LINKS, ['users', 'Users'] as const] : LINKS;
  const logout = (): void => {
    apiSend('POST', '/logout').finally(onLogout);
  };
  return (
    <div className="admin-shell">
      <nav className="admin-sidebar" aria-label="Admin">
        <span className="admin-brand">b24auth-server</span>
        <ul className="admin-nav">
          {links.map(([path, label]) => (
            <li key={path}>
              <NavLink to={`/admin/${path}`}>{label}</NavLink>
            </li>
          ))}
        </ul>
        <div className="admin-user">
          <span>{user.login}</span>
          <span className="admin-role">{user.role}</span>
          <button type="button" className="admin-button admin-button--ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
