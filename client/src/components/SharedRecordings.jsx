import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { listSharedRecordings, downloadSelfRecording, unshareSelfRecording } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function SharedRecordings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState([]);
  const [error, setError] = useState('');

  function refresh() {
    listSharedRecordings()
      .then((data) => setRecordings(data.recordings))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/shared-recordings');
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, navigate]);

  if (authLoading || !user) return null;

  async function download(recordingId) {
    setError('');
    try {
      await downloadSelfRecording(recordingId);
    } catch (err) {
      setError(err.message || 'Could not download this recording.');
    }
  }

  async function unshare(recordingId) {
    setError('');
    try {
      await unshareSelfRecording(recordingId);
      refresh();
    } catch (err) {
      setError(err.message || 'Could not unshare this recording.');
    }
  }

  return (
    <div className="page">
      <TopBar title="Shared recordings" backTo="/" />
      <div className="admin-wrap">
        <h1>Recordings shared with me</h1>
        {error && <p className="error">{error}</p>}
        {recordings.length === 0 && !error && <p className="muted">Nothing shared with you yet.</p>}
        {recordings.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                {recordings[0].staffName && <th>Shared with</th>}
                <th>Shared</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>{r.studentName}</td>
                  {r.staffName && <td>{r.staffName}</td>}
                  <td>{new Date(r.sharedAt).toLocaleString()}</td>
                  <td>
                    <button className="ghost" onClick={() => download(r.id)}>
                      Download
                    </button>
                    <button className="ghost" onClick={() => unshare(r.id)}>
                      Unshare
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
