import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import { createRoom, listSubjects } from './lib/api.js';
import Home from './components/Home.jsx';

export default function App() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [allowGuests, setAllowGuests] = useState(false);

  const canHost = user?.role === 'staff' || user?.role === 'superadmin';

  useEffect(() => {
    if (!canHost) return;
    listSubjects()
      .then((data) => setSubjects(data.subjects))
      .catch(() => {});
  }, [canHost]);

  if (loading) return null;

  if (!user) {
    return <Home />;
  }

  async function startClass() {
    setStarting(true);
    setError('');
    try {
      const { roomId } = await createRoom(duration ? Number(duration) : null, subjectId || null, allowGuests);
      navigate(`/room/${roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

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
            {subjects.length > 0 && (
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                style={{ marginTop: 8 }}
              >
                <option value="">No subject (attendance won't be tracked)</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 8,
                fontSize: '0.85rem',
                color: '#c7d3cf',
              }}
            >
              <input
                type="checkbox"
                checked={allowGuests}
                onChange={(e) => setAllowGuests(e.target.checked)}
              />
              Allow anyone with the link to join without an account
            </label>
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

            <Link to="/profile" className="dash-tile">
              <div className="dash-tile-icon">👤</div>
              <span className="dash-tile-title">Profile</span>
              <span className="dash-tile-desc">Update your name or change your password.</span>
            </Link>

            <Link to="/my-recordings" className="dash-tile">
              <div className="dash-tile-icon">🎥</div>
              <span className="dash-tile-title">My recordings</span>
              <span className="dash-tile-desc">
                {user.role === 'student'
                  ? "Recordings you've made and shared with staff."
                  : "Recordings you've made and shared with students."}
              </span>
            </Link>

            {(user.role === 'staff' || user.role === 'superadmin') && (
              <Link to="/shared-recordings" className="dash-tile">
                <div className="dash-tile-icon">🎥</div>
                <span className="dash-tile-title">Shared recordings</span>
                <span className="dash-tile-desc">
                  {user.role === 'superadmin'
                    ? 'Every recording students have shared with staff.'
                    : "Recordings students have shared with you."}
                </span>
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

        <div className="dashboard-footer">
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
