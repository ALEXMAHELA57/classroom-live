import { useEffect, useRef, useState } from 'react';
import { API_BASE, getToken } from '../lib/auth.js';

export default function FileShare({ roomId, isTeacher }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/files`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) setFiles(data.files);
    } catch {
      // silent — file list just won't refresh this round
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000); // simple polling, no socket event for this yet
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(file) {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}/files/${file.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.originalName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Files {files.length > 0 && <span className="badge">{files.length}</span>} {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {isTeacher && (
            <>
              <input ref={inputRef} type="file" onChange={upload} disabled={uploading} />
              {uploading && <p className="muted">Uploading…</p>}
              {error && <p className="error">{error}</p>}
            </>
          )}
          <ul className="roster-list">
            {files.length === 0 && <p className="muted">No files shared yet.</p>}
            {files.map((f) => (
              <li key={f.id} className="file-row">
                <span>{f.originalName}</span>
                <button className="ghost" onClick={() => download(f)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
