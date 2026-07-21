import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listLiveSessions } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function LiveSessions() {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function refresh() {
    try {
      const data = await listLiveSessions();
      setSessions(data.sessions);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page">
      <TopBar title="Live sessions" backTo="/" />
      <div className="admin-wrap">
        <h1>Live sessions</h1>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          You'll join as an observer, not as the teacher — moderation controls stay with whoever
          actually created the class.
        </p>
        {error && <p className="error">{error}</p>}
        {sessions.length === 0 && !error && <p className="muted">No ongoing sessions right now.</p>}
        {sessions.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Started</th>
                <th>Students</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.roomId}>
                  <td>{s.teacherName}{!s.teacherConnected && <span className="muted"> (not currently connected)</span>}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>{s.studentCount}</td>
                  <td>
                    <button className="ghost" onClick={() => navigate(`/room/${s.roomId}`)}>
                      Join
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
