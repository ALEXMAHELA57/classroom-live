import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../lib/auth.js';
import PasswordStrength, { isPasswordValid } from './PasswordStrength.jsx';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-mark">CL</div>
          <h1>Invalid link</h1>
          <p className="muted">This reset link is missing its token — try requesting a new one.</p>
          <Link to="/forgot-password">
            <button style={{ width: '100%' }}>Request a new link</button>
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-mark">CL</div>
          <h1>Password updated</h1>
          <p className="muted">You can log in with your new password now.</p>
          <button onClick={() => navigate('/login')} style={{ width: '100%' }}>
            Go to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">CL</div>
        <h1>Set a new password</h1>
        <form onSubmit={submit}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <PasswordStrength password={password} />
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button type="submit" disabled={loading || !isPasswordValid(password) || !confirm}>
            {loading ? 'Saving…' : 'Set new password'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
