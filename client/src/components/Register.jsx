import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, registerWithGoogle } from '../lib/auth.js';
import GoogleButton from './GoogleButton.jsx';
import PasswordStrength, { isPasswordValid } from './PasswordStrength.jsx';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential) {
    setError('');
    try {
      await registerWithGoogle(credential, form.role);
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-mark">CL</div>
          <h1>Account created</h1>
          <p className="muted">
            An admin needs to approve your account before you can log in. Check back soon.
          </p>
          <button onClick={() => navigate('/login')} style={{ width: '100%' }}>Go to login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">CL</div>
        <h1>Create an account</h1>
        <p className="muted">A few details and you're set.</p>
        <label>I am a</label>
        <div className="role-toggle">
          <button
            type="button"
            className={form.role === 'student' ? 'active' : ''}
            onClick={() => update('role', 'student')}
          >
            Student
          </button>
          <button
            type="button"
            className={form.role === 'staff' ? 'active' : ''}
            onClick={() => update('role', 'staff')}
          >
            Staff / teacher
          </button>
        </div>
        <div className="google-button-wrap">
          <GoogleButton text="signup_with" onCredential={handleGoogleCredential} />
        </div>
        <div className="auth-divider"><span>or use email</span></div>
        <form onSubmit={submit}>
          <label htmlFor="name">Full name</label>
          <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
          <PasswordStrength password={form.password} />
          <button
            type="submit"
            disabled={loading || !form.name || !form.email || !isPasswordValid(form.password)}
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted center-pad-sm">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
