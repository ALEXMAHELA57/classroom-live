import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  listSubjects,
  createScheduledClass,
  listScheduledClasses,
  cancelScheduledClass,
  startScheduledClass,
} from '../lib/api.js';
import TopBar from './TopBar.jsx';

const PRIMARY_CLIENT_ORIGIN = window.location.origin;

export default function Schedule() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isHost = user?.role === 'staff' || user?.role === 'superadmin';

  const [subjects, setSubjects] = useState([]);
  const [scheduledClasses, setScheduledClasses] = useState([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [startingId, setStartingId] = useState(null);

  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [allowGuests, setAllowGuests] = useState(false);

  function refresh() {
    listScheduledClasses()
      .then((data) => setScheduledClasses(data.scheduledClasses))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/schedule');
      return;
    }
    refresh();
    if (isHost) {
      listSubjects()
        .then((data) => setSubjects(data.subjects))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading || !user) return null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!date || !time) {
      setError('Pick a date and time');
      return;
    }
    const scheduledAt = new Date(`${date}T${time}`).getTime();
    setCreating(true);
    try {
      await createScheduledClass({
        subjectId: subjectId || null,
        title,
        scheduledAt,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        allowGuests,
      });
      setTitle('');
      setSubjectId('');
      setDate('');
      setTime('');
      setDurationMinutes('');
      setAllowGuests(false);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id) {
    if (!window.confirm('Cancel this scheduled class?')) return;
    try {
      await cancelScheduledClass(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function start(id) {
    setStartingId(id);
    try {
      const { roomId } = await startScheduledClass(id);
      navigate(`/room/${roomId}`);
    } catch (err) {
      setError(err.message);
      setStartingId(null);
    }
  }

  return (
    <div className="page">
      <TopBar title="Schedule" backTo="/" />
      <div className="admin-wrap">
        <h1>{isHost ? 'Schedule a class or meeting' : 'Upcoming scheduled classes'}</h1>
        {error && <p className="error">{error}</p>}

        {isHost && (
          <form className="card" onSubmit={submit} style={{ marginBottom: '1.5rem' }}>
            <label>Title</label>
            <input
              type="text"
              placeholder="e.g. Algebra revision, or Parent info session"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <label>Subject (optional — leave blank for a standalone meeting)</label>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="admin-create-form">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label>Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </div>
            </div>
            <label>Duration in minutes (optional)</label>
            <input
              type="number"
              placeholder="No time limit"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              min="1"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={allowGuests}
                onChange={(e) => setAllowGuests(e.target.checked)}
              />
              Allow anyone with the link to join without an account
            </label>
            <button type="submit" disabled={creating || !title.trim()}>
              {creating ? 'Scheduling…' : 'Schedule'}
            </button>
          </form>
        )}

        <h3>Upcoming</h3>
        {scheduledClasses.length === 0 && <p className="muted">Nothing scheduled yet.</p>}
        {scheduledClasses.map((sc) => (
          <div className="card subject-card" key={sc.id}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              {sc.title}
              {sc.isLive && <span className="home-upcoming-live-badge">Live now</span>}
            </p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {new Date(sc.scheduledAt).toLocaleString()}
              {sc.subjectName && ` — ${sc.subjectName}`}
              {!sc.subjectName && ' — standalone meeting'}
              {sc.durationMinutes && ` — ${sc.durationMinutes} min`}
            </p>
            {isHost && sc.hostUserId === user.id && (
              <div className="admin-create-form">
                {sc.isLive ? (
                  <button onClick={() => navigate(`/room/${sc.roomId}`)}>Join</button>
                ) : (
                  <button onClick={() => start(sc.id)} disabled={startingId === sc.id}>
                    {startingId === sc.id ? 'Starting…' : 'Start now'}
                  </button>
                )}
                {!sc.isLive && (
                  <button className="ghost" onClick={() => cancel(sc.id)}>
                    Cancel
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(`${PRIMARY_CLIENT_ORIGIN}/scheduled/${sc.id}`);
                  }}
                >
                  Copy invite link
                </button>
              </div>
            )}
            {sc.isLive && !(isHost && sc.hostUserId === user.id) && (
              <div className="admin-create-form">
                <button onClick={() => navigate(`/room/${sc.roomId}`)}>Join</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
