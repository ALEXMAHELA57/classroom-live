import { Fragment, useEffect, useState } from 'react';
import { API_BASE, getToken } from '../lib/auth.js';
import TopBar from './TopBar.jsx';

async function authedFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [creating, setCreating] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  async function refresh() {
    try {
      const data = await authedFetch('/api/admin/users');
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function approve(id) {
    await authedFetch(`/api/admin/users/${id}/approve`, { method: 'PATCH' });
    refresh();
  }
  async function disable(id) {
    await authedFetch(`/api/admin/users/${id}/disable`, { method: 'PATCH' });
    refresh();
  }

  async function submitResetPassword(userId) {
    setResetting(true);
    setResetMessage('');
    try {
      await authedFetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetPasswordValue }),
      });
      setResetMessage('Password updated — let them know their new password directly.');
      setResetPasswordValue('');
    } catch (err) {
      setResetMessage(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function createAccount(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await authedFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: '', role: 'student' });
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="Manage accounts" backTo="/" />
      <div className="admin-wrap">
        <h1>Accounts</h1>
        {error && <p className="error">{error}</p>}

        <div className="card admin-create">
          <h3>Create an account</h3>
          <form onSubmit={createAccount} className="admin-create-form">
            <input
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="student">Student</option>
              <option value="staff">Staff / teacher</option>
              <option value="superadmin">Superadmin</option>
            </select>
            <button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create (auto-approved)'}
            </button>
          </form>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    <span className={`status-badge status-${u.status}`}>{u.status}</span>
                  </td>
                  <td className="admin-actions">
                    {u.status !== 'approved' && (
                      <button className="ghost" onClick={() => approve(u.id)}>
                        Approve
                      </button>
                    )}
                    {u.status !== 'disabled' && (
                      <button className="ghost" onClick={() => disable(u.id)}>
                        Disable
                      </button>
                    )}
                    <button
                      className="ghost"
                      onClick={() => {
                        setResettingId(resettingId === u.id ? null : u.id);
                        setResetMessage('');
                        setResetPasswordValue('');
                      }}
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
                {resettingId === u.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="admin-reset-row">
                        <input
                          type="password"
                          placeholder={`New password for ${u.name}`}
                          value={resetPasswordValue}
                          onChange={(e) => setResetPasswordValue(e.target.value)}
                        />
                        <button
                          onClick={() => submitResetPassword(u.id)}
                          disabled={resetting || resetPasswordValue.length < 8}
                        >
                          {resetting ? 'Saving…' : 'Save new password'}
                        </button>
                        {resetMessage && <span className="muted">{resetMessage}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
