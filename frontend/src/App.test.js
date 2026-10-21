import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/dashboard');
  global.fetch = jest.fn();
});

test('redirects signed-out visitors without requesting private data', () => {
  render(<App />);
  expect(screen.getByText('Welcome back')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('shows the current user and clears the session on logout', async () => {
  localStorage.setItem('access_token', 'test-token');
  localStorage.setItem('user_id', '123');
  localStorage.setItem('user_name', 'Alex');
  localStorage.setItem('theme', 'dark');
  global.fetch.mockImplementation(async url => ({
    ok: true,
    json: async () => url.endsWith('/auth/me')
      ? { name: 'Alex', email: 'alex@example.com' } : [],
  }));
  render(<App />);
  expect(await screen.findByText('Alex')).toBeInTheDocument();
  expect(screen.queryByText('alex@example.com')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  ['access_token', 'user_id', 'user_name'].forEach(key => expect(localStorage.getItem(key)).toBeNull());
  expect(localStorage.getItem('theme')).toBe('dark');
});

test('rejects expired sessions before mounting the dashboard', async () => {
  localStorage.setItem('access_token', 'expired');
  global.fetch.mockResolvedValue({ ok: false, status: 401 });
  render(<App />);
  expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('access_token')).toBeNull();
});
