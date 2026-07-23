import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import GoogleButton from './GoogleButton.jsx';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const redirectTo = new URLSearchParams(location.search).get('redirect') || '/';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email, password });
      navigate(redirectTo);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential) {
    setError('');
    try {
      await loginWithGoogle(credential);
      navigate(redirectTo);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">CL</div>
        <h1>Log in</h1>
        <p className="muted">Welcome back — enter your details to continue.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={loading || !email || !password}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        <div className="auth-divider"><span>or</span></div>
        <div className="google-button-wrap">
          <GoogleButton text="signin_with" onCredential={handleGoogleCredential} />
        </div>
        <p className="muted center-pad-sm">
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
