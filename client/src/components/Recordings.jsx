import { useEffect, useState } from 'react';
import { API_BASE, getToken } from '../lib/auth.js';

export default function Recordings({ roomId, refreshKey }) {
  const [recordings, setRecordings] = useState([]);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const [open, setOpen] = useState(false);

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/recordings`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) setRecordings(data.recordings);
    } catch {
      // silent — list just won't refresh this round
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, refreshKey]);

  // While anything is still "processing" (LiveKit hasn't confirmed the
  // upload finished yet), poll every few seconds so it flips to
  // "completed" — and becomes downloadable — without the person needing
  // to manually reopen this panel.
  useEffect(() => {
    if (!recordings.some((r) => r.status === 'processing')) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordings]);

  async function download(recording) {
    setDownloadingId(recording.id);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/api/rooms/${roomId}/recordings/${recording.id}/download-url`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not get download link');
      // Navigating the browser to a presigned R2 URL downloads the file
      // directly to the device — it never passes through our server.
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Recordings {recordings.length > 0 && <span className="badge">{recordings.length}</span>} {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {error && <p className="error">{error}</p>}
          <ul className="roster-list">
            {recordings.length === 0 && <p className="muted">No recordings yet.</p>}
            {recordings.map((r) => (
              <li key={r.id} className="file-row">
                <span>{new Date(r.startedAt).toLocaleString()}</span>
                {r.status === 'processing' ? (
                  <span className="muted">Processing…</span>
                ) : (
                  <button className="ghost" onClick={() => download(r)} disabled={downloadingId === r.id}>
                    {downloadingId === r.id ? 'Preparing…' : 'Download'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
