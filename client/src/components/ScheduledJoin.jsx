import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPublicScheduledInfo } from '../lib/api.js';

// Polling rather than a websocket/push mechanism — simplest option for
// something that only needs to notice "has the host started yet" a
// handful of times over the minutes leading up to a scheduled class.
const POLL_MS = 10000;

export default function ScheduledJoin() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    function poll() {
      getPublicScheduledInfo(id)
        .then((data) => {
          if (cancelled) return;
          setInfo(data);
          if (data.roomId) {
            navigate(`/join/${data.roomId}`);
          }
        })
        .catch((err) => !cancelled && setError(err.message));
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, navigate]);

  if (error) {
    return (
      <div className="page centered">
        <div className="card">
          <h1>Scheduled class</h1>
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }

  if (!info) return null;

  if (info.canceled) {
    return (
      <div className="page centered">
        <div className="card">
          <h1>{info.title}</h1>
          <p className="error">This scheduled class was canceled.</p>
        </div>
      </div>
    );
  }

  const scheduledDate = new Date(info.scheduledAt);
  const isPast = scheduledDate.getTime() <= Date.now();

  return (
    <div className="page centered">
      <div className="card">
        <h1>{info.title}</h1>
        <p className="muted">{scheduledDate.toLocaleString()}</p>
        <p className="muted" style={{ marginTop: 10 }}>
          {isPast
            ? "Waiting for the host to start — this page will move you in automatically once they do."
            : `Starts ${scheduledDate.toLocaleString()}. This page will move you in automatically once the host starts it.`}
        </p>
      </div>
    </div>
  );
}
