import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Dashboard from './Dashboard';

export default function AccountDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem('access_token'));
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const logout = () => {
    ['access_token', 'user_id', 'user_name'].forEach(key => localStorage.removeItem(key));
    setUser(null);
    setToken(null);
  };

  useEffect(() => {
    const syncSession = (event) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== 'access_token')) return;
      if (localStorage.getItem('access_token') === token) return;
      setUser(null);
      setToken(localStorage.getItem('access_token'));
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setError('');
    fetch('http://localhost:8000/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        logout();
        return;
      }
      if (!response.ok) throw new Error('Unable to load your account. Please try again.');
      const profile = await response.json();
      if (!controller.signal.aborted) setUser(profile);
    }).catch(err => {
      if (!controller.signal.aborted) setError('Unable to load your account. Please try again.');
    });
    return () => controller.abort();
  }, [token, attempt]);

  if (!token) return <Navigate to="/signin" replace />;
  if (!user) return (
    <div className="min-h-screen bg-[#0e0e14] text-[#e2e2f0] flex flex-col items-center justify-center gap-4">
      {error ? <>
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt(value => value + 1)}>Try again</button>
      </> : <p role="status">Loading your account…</p>}
      <button onClick={logout}>Log out</button>
    </div>
  );
  return <Dashboard user={user} onLogout={logout} />;
}
