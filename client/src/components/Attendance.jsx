import { useEffect, useState } from 'react';
import { getAttendance } from '../lib/api.js';

export default function Attendance({ roomId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function refresh() {
    getAttendance(roomId)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!open) return;
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomId]);

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Attendance {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {error && <p className="error">{error}</p>}
          {!error && !data && <p className="muted">Loading…</p>}
          {data && !data.hasSubject && (
            <p className="muted">
              This class isn't linked to a subject, so attendance isn't tracked. Start a new class
              and pick a subject from the dropdown to enable this next time.
            </p>
          )}
          {data && data.hasSubject && (
            <>
              <p className="admin-section-label" style={{ marginTop: 4 }}>
                Present ({data.present.length})
              </p>
              {data.present.length === 0 && <p className="muted">No one yet.</p>}
              <ul className="roster-list">
                {data.present.map((s) => (
                  <li key={s.id} className="file-row">
                    <span>{s.name}</span>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {new Date(s.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="admin-section-label" style={{ marginTop: 14 }}>
                Absent ({data.absent.length})
              </p>
              {data.absent.length === 0 && <p className="muted">Everyone enrolled has joined.</p>}
              <ul className="roster-list">
                {data.absent.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
