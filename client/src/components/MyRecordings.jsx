import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  listMySelfRecordings,
  listStaff,
  shareSelfRecording,
  unshareSelfRecording,
  downloadSelfRecording,
  uploadSelfRecording,
  listShareableStudents,
  shareRecordingWithStudents,
  unshareRecordingFromStudent,
  getRecordingShares,
  listSharedRecordings,
} from '../lib/api.js';
import SelfRecorder from './SelfRecorder.jsx';
import TopBar from './TopBar.jsx';

export default function MyRecordings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isStaff = user?.role === 'staff' || user?.role === 'superadmin';

  const [recordings, setRecordings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [students, setStudents] = useState([]);
  const [sharedWithMe, setSharedWithMe] = useState([]);
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
    if (isStaff) {
      listShareableStudents()
        .then((data) => setStudents(data.students))
        .catch((err) => setError(`Could not load your students: ${err.message}`));
    } else {
      listStaff()
        .then((data) => setStaff(data.staff))
        .catch((err) => setError(`Could not load staff list: ${err.message}`));
      listSharedRecordings()
        .then((data) => setSharedWithMe(data.recordings))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading || !user) return null;

  async function download(recordingId) {
    setError('');
    try {
      await downloadSelfRecording(recordingId);
    } catch (err) {
      setError(err.message || 'Could not download this recording.');
    }
  }

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

  async function unshare(recordingId) {
    try {
      await unshareSelfRecording(recordingId);
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
          {isStaff
            ? 'Record yourself directly from your account — useful for a video announcement, a lesson recap, or feedback for a specific student. Share it with one or more students, or everyone across the subjects you teach.'
            : 'Record yourself directly from your account — no class session needed. Useful for recording a response to an assignment: record here, then share it with the staff member who assigned it. Note: only text and PDF/Word file submissions get auto-graded — a video recording needs to be reviewed by the teacher directly.'}
        </p>
        {uploadError && <p className="error">{uploadError}</p>}
        {uploadingNew ? (
          <p className="muted">Uploading your recording…</p>
        ) : (
          <SelfRecorder onRecorded={handleNewRecording} />
        )}

        {justRecordedId && !isStaff && (
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

        {justRecordedId && isStaff && (
          <div className="card subject-card" style={{ borderColor: 'var(--chalkboard)', marginTop: '1rem' }}>
            <p className="admin-section-label" style={{ marginTop: 0 }}>Recording saved — share it now?</p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              Pick it up from the list below to choose specific students, or share it with everyone
              across your subjects right now.
            </p>
            <div className="admin-create-form">
              <button
                onClick={async () => {
                  setSharingJustRecorded(true);
                  try {
                    await shareRecordingWithStudents(justRecordedId, { all: true });
                    setJustRecordedId(null);
                    refresh();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setSharingJustRecorded(false);
                  }
                }}
                disabled={sharingJustRecorded}
              >
                {sharingJustRecorded ? 'Sharing…' : 'Share with all my students'}
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
        {recordings.map((r) =>
          isStaff ? (
            <StaffRecordingCard key={r.id} recording={r} students={students} onDownload={download} onChanged={refresh} onError={setError} />
          ) : (
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
                {r.sharedWithName && (
                  <button className="ghost" onClick={() => unshare(r.id)}>
                    Unshare
                  </button>
                )}
                <button className="ghost" onClick={() => download(r.id)}>
                  Download
                </button>
              </div>
            </div>
          )
        )}

        {!isStaff && (
          <>
            <h3 style={{ marginTop: '2rem' }}>Shared with me</h3>
            {sharedWithMe.length === 0 && <p className="muted">Nothing shared with you yet.</p>}
            {sharedWithMe.map((r) => (
              <div className="card subject-card" key={r.id}>
                <p>
                  {new Date(r.createdAt).toLocaleString()}
                  {r.creatorName && <span className="muted"> — from {r.creatorName}</span>}
                </p>
                <div className="admin-create-form">
                  <button className="ghost" onClick={() => download(r.id)}>
                    Download
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Staff/admin share UI for a single recording: pick specific students
// (checkboxes), share with everyone across the creator's subjects, and
// manage/remove existing recipients — a fundamentally different shape
// from the student's single-staff-member dropdown, so this stays a
// separate component rather than branching every line of one shared one.
function StaffRecordingCard({ recording, students, onDownload, onChanged, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState([]);
  const [shares, setShares] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (expanded && shares === null) {
      getRecordingShares(recording.id)
        .then((data) => setShares(data.shares))
        .catch((err) => onError(err.message));
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePicked(studentId) {
    setPicked((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  async function shareSelected() {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      await shareRecordingWithStudents(recording.id, { studentIds: picked });
      setPicked([]);
      const data = await getRecordingShares(recording.id);
      setShares(data.shares);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function shareAll() {
    setBusy(true);
    try {
      await shareRecordingWithStudents(recording.id, { all: true });
      const data = await getRecordingShares(recording.id);
      setShares(data.shares);
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeShare(studentId) {
    setBusy(true);
    try {
      await unshareRecordingFromStudent(recording.id, studentId);
      setShares((prev) => prev.filter((s) => s.id !== studentId));
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card subject-card">
      <p>{new Date(recording.createdAt).toLocaleString()}</p>
      <div className="admin-create-form">
        <button className="ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide sharing' : 'Share / manage'}
        </button>
        <button className="ghost" onClick={() => onDownload(recording.id)}>
          Download
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          {shares && shares.length > 0 && (
            <>
              <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 4 }}>
                Currently shared with:
              </p>
              <ul className="roster-list roster-mod">
                {shares.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <button className="ghost" onClick={() => removeShare(s.id)} disabled={busy}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {students.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              You don't have any students enrolled yet.
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: '0.78rem', margin: '10px 0 4px' }}>
                Share with specific students:
              </p>
              <ul className="roster-list roster-mod">
                {students.map((s) => (
                  <li key={s.id}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={picked.includes(s.id)}
                        onChange={() => togglePicked(s.id)}
                      />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="admin-create-form">
                <button onClick={shareSelected} disabled={picked.length === 0 || busy}>
                  Share with selected ({picked.length})
                </button>
                <button className="ghost" onClick={shareAll} disabled={busy}>
                  Share with all my students
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
