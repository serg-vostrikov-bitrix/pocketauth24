import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { apiGet, setUnauthorizedHandler, type AdminUser } from './api';
import { Layout } from './Layout';
import { LoginPage } from './LoginPage';
import { ApplicationsPage, EventsPage, PortalsPage, TokensPage } from './pages';
import { UsersPage } from './UsersPage';
import './admin.css';

export function AdminApp() {
  const navigate = useNavigate();
  // undefined: the session check runs; null: no session.
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);

  useEffect(() => {
    const previous = document.title;
    document.title = 'PocketAuth24 admin';
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      navigate('/admin/login', { replace: true });
    });
    apiGet<AdminUser>('/me').then(setUser, () => setUser(null));
  }, [navigate]);

  if (user === undefined) return null;
  if (user === null) {
    return (
      <Routes>
        <Route path="login" element={<LoginPage onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout user={user} onLogout={() => setUser(null)} />}>
        <Route path="portals" element={<PortalsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="events" element={<EventsPage />} />
        {user.role === 'superuser' && <Route path="users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/admin/portals" replace />} />
      </Route>
    </Routes>
  );
}
