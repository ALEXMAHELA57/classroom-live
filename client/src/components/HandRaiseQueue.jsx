import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';

export default function HandRaiseQueue() {
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (q) => setQueue(q);
    socket.on('hand:queue-update', onUpdate);
    return () => socket.off('hand:queue-update', onUpdate);
  }, []);

  function resolve(requestId) {
    getSocket().emit('hand:resolve', { requestId });
  }

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Raised hands {queue.length > 0 && <span className="badge">{queue.length}</span>} {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {queue.length === 0 && <p className="muted">No one has raised their hand.</p>}
          <ul className="hand-queue">
            {queue.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  {r.question && <p className="muted">{r.question}</p>}
                </div>
                <button className="ghost" onClick={() => resolve(r.id)}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
