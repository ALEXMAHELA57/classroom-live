import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { listMySelfRecordings, listStaff, shareSelfRecording, downloadSelfRecording, uploadSelfRecording } from '../lib/api.js';
import SelfRecorder from './SelfRecorder.jsx';
import TopBar from './TopBar.jsx';

export default function MyRecordings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState({});
  const [uploadingNew, setUploadingNew] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [justRecordedId, setJustRecordedId] = useState(null);
  const [justRecordedStaffId, setJustRecordedStaffId] = useState('');
  const [sharingJustRecorded, setSharingJustRecorded] = useState(false);

  async function handleNewRecording(blob) {
    setUploadingNew(true);
    setUploadError('');
    try {
      const data = await uploadSelfRecording(blob);
      setJustRecordedId(data.recording.id);
      setJustRecordedStaffId('');
      refresh();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploadingNew(false);
    }
  }

  async function shareJustRecorded() {
    if (!justRecordedId || !justRecordedStaffId) return;
    setSharingJustRecorded(true);
    try {
      await shareSelfRecording(justRecordedId, justRecordedStaffId);
      setJustRecordedId(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSharingJustRecorded(false);
    }
  }

  async function refresh() {
    try {
      const data = await listMySelfRecordings();
      setRecordings(data.recordings);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/my-recordings');
      return;
    }
    refresh();
    listStaff()
      .then((data) => setStaff(data.staff))
      .catch((err) => setError(`Could not load staff list: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading || !user) return null;

  async function share(recordingId) {
    const staffId = selected[recordingId];
    if (!staffId) return;
    try {
      await shareSelfRecording(recordingId, staffId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <TopBar title="My recordings" backTo="/" />
      <div className="admin-wrap">
        <h1>My recordings</h1>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Record yourself directly from your account — no class session needed. Useful for
          recording a response to an assignment: record here, then share it with the staff member
          who assigned it. Note: only text and PDF/Word file submissions get auto-graded — a video
          recording needs to be reviewed by the teacher directly.
        </p>
        {uploadError && <p className="error">{uploadError}</p>}
        {uploadingNew ? (
          <p className="muted">Uploading your recording…</p>
        ) : (
          <SelfRecorder onRecorded={handleNewRecording} />
        )}

        {justRecordedId && (
          <div className="card subject-card" style={{ borderColor: 'var(--chalkboard)', marginTop: '1rem' }}>
            <p className="admin-section-label" style={{ marginTop: 0 }}>Recording saved — share it now?</p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              Choose who this recording is for, or skip and share it later from the list below.
            </p>
            <div className="admin-create-form">
              <select
                value={justRecordedStaffId}
                onChange={(e) => setJustRecordedStaffId(e.target.value)}
                autoFocus
              >
                <option value="">Share with…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.role === 'superadmin' ? ' (Admin)' : ''}
                  </option>
                ))}
              </select>
              <button onClick={shareJustRecorded} disabled={!justRecordedStaffId || sharingJustRecorded}>
                {sharingJustRecorded ? 'Sharing…' : 'Share'}
              </button>
              <button className="ghost" onClick={() => setJustRecordedId(null)}>
                Skip for now
              </button>
            </div>
          </div>
        )}

        <h3 style={{ marginTop: '1.5rem' }}>Saved recordings</h3>
        {error && <p className="error">{error}</p>}
        {recordings.length === 0 && <p className="muted">No recordings yet.</p>}
        {recordings.map((r) => (
          <div className="card subject-card" key={r.id}>
            <p>
              {new Date(r.createdAt).toLocaleString()}
              {r.sharedWithName && (
                <span className="muted"> — shared with {r.sharedWithName}</span>
              )}
            </p>
            <div className="admin-create-form">
              <select
                value={selected[r.id] || ''}
                onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.value }))}
              >
                <option value="">Share with…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.role === 'superadmin' ? ' (Admin)' : ''}
                  </option>
                ))}
              </select>
              <button onClick={() => share(r.id)} disabled={!selected[r.id]}>
                Share
              </button>
              <button className="ghost" onClick={() => downloadSelfRecording(r.id)}>
                Download
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
