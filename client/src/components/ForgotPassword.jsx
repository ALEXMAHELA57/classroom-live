import { useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../lib/auth.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong');
      }
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">CL</div>
        <h1>Reset your password</h1>
        {done ? (
          <>
            <p className="muted">
              If an account exists for <strong>{email}</strong>, a reset link is on its way — check
              your inbox (and spam folder). It expires in 1 hour.
            </p>
            <Link to="/login">
              <button style={{ width: '100%' }}>Back to login</button>
            </Link>
          </>
        ) : (
          <>
            <p className="muted">Enter your email and we'll send you a link to set a new one.</p>
            <form onSubmit={submit}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              <button type="submit" disabled={loading || !email}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
            <p className="muted center-pad-sm">
              <Link to="/login">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
