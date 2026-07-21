import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';

export default function Roster() {
  const [students, setStudents] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (list) => setStudents(list);
    socket.on('roster:update', onUpdate);
    return () => socket.off('roster:update', onUpdate);
  }, []);

  function mute(identity) {
    if (identity) getSocket().emit('mod:mute', { identity });
  }
  function remove(identity) {
    if (identity && window.confirm('Remove this student from the class?')) {
      getSocket().emit('mod:remove', { identity });
    }
  }
  function muteAll() {
    getSocket().emit('mod:mute-all');
  }

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Students ({students.length}) {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {students.length > 0 && (
            <button className="ghost" onClick={muteAll} style={{ marginBottom: 8 }}>
              Mute all
            </button>
          )}
          <ul className="roster-list roster-mod">
            {students.length === 0 && <p className="muted">No students yet.</p>}
            {students.map((s, i) => (
              <li key={`${s.identity || s.name}-${i}`}>
                <span>{s.name}</span>
                <span className="roster-actions">
                  <button className="ghost" onClick={() => mute(s.identity)} disabled={!s.identity}>
                    Mute
                  </button>
                  <button className="ghost" onClick={() => remove(s.identity)} disabled={!s.identity}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
