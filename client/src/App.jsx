import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import { createRoom } from './lib/api.js';

export default function App() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState('');

  if (loading) return null;

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-mark">CL</div>
          <h1>Classroom Live</h1>
          <p className="muted">Log in to start or join a class.</p>
          <Link to="/login"><button style={{ width: '100%' }}>Log in</button></Link>
          <p className="muted center-pad-sm">
            No account? <Link to="/register">Register</Link>
          </p>
        </div>
      </div>
    );
  }

  async function startClass() {
    setStarting(true);
    setError('');
    try {
      const { roomId } = await createRoom(duration ? Number(duration) : null);
      navigate(`/room/${roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const canHost = user.role === 'staff' || user.role === 'superadmin';
  const roleLabel = { staff: 'Teacher', student: 'Student', superadmin: 'Admin' }[user.role] || user.role;

  return (
    <div className="dashboard-shell">
      <div className="dashboard-header">
        <p className="dashboard-eyebrow">{roleLabel} dashboard</p>
        <h1>Welcome back, {user.name.split(' ')[0]}</h1>
        <p className="muted">Signed in as {user.name} · {user.email}</p>
      </div>

      <div className="dashboard-body">
        {canHost && (
          <div className="dash-tile primary" style={{ cursor: 'default', marginBottom: '1.75rem' }}>
            <div className="dash-tile-icon">●</div>
            <span className="dash-tile-title">Start a class</span>
            <span className="dash-tile-desc">Opens a live room right away — share the link with your students.</span>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="duration"
                type="number"
                min="1"
                placeholder="No time limit"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={{ margin: 0, flex: 1 }}
              />
              <button onClick={startClass} disabled={starting} style={{ flexShrink: 0 }}>
                {starting ? 'Starting…' : 'Start'}
              </button>
            </div>
            {error && <p className="error" style={{ color: '#f2c4b6' }}>{error}</p>}
          </div>
        )}

        {!canHost && (
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            Your teacher will share an invite link when it's time to join a class.
          </p>
        )}

        <div className="dashboard-section">
          <div className="dashboard-grid">
            <Link to="/subjects" className="dash-tile">
              <div className="dash-tile-icon">📚</div>
              <span className="dash-tile-title">Subjects</span>
              <span className="dash-tile-desc">
                {canHost ? 'Syllabi, quizzes, assignments, and rosters.' : 'Your classes, quizzes, and assignments.'}
              </span>
            </Link>

            <Link to="/billing" className="dash-tile">
              <div className="dash-tile-icon">💳</div>
              <span className="dash-tile-title">Billing</span>
              <span className="dash-tile-desc">Manage your plan and payment details.</span>
            </Link>

            {user.role === 'student' && (
              <Link to="/my-recordings" className="dash-tile">
                <div className="dash-tile-icon">🎥</div>
                <span className="dash-tile-title">My recordings</span>
                <span className="dash-tile-desc">Recordings you've made and shared with staff.</span>
              </Link>
            )}

            {user.role === 'staff' && (
              <Link to="/shared-recordings" className="dash-tile">
                <div className="dash-tile-icon">🎥</div>
                <span className="dash-tile-title">Shared recordings</span>
                <span className="dash-tile-desc">Recordings students have shared with you.</span>
              </Link>
            )}

            {user.role === 'superadmin' && (
              <Link to="/admin" className="dash-tile">
                <div className="dash-tile-icon">👥</div>
                <span className="dash-tile-title">Manage accounts</span>
                <span className="dash-tile-desc">Approve, disable, or review staff and student accounts.</span>
              </Link>
            )}

            {user.role === 'superadmin' && (
              <Link to="/admin/live-sessions" className="dash-tile">
                <div className="dash-tile-icon">📡</div>
                <span className="dash-tile-title">Live sessions</span>
                <span className="dash-tile-desc">See which classes are in progress right now.</span>
              </Link>
            )}
          </div>
        </div>

        <button className="ghost" style={{ marginTop: '2rem' }} onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}
