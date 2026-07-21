import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { listSharedRecordings, downloadSelfRecording } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function SharedRecordings() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/shared-recordings');
      return;
    }
    listSharedRecordings()
      .then((data) => setRecordings(data.recordings))
      .catch((err) => setError(err.message));
  }, [authLoading, user, navigate]);

  if (authLoading || !user) return null;

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
                <th>Shared</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>{r.studentName}</td>
                  <td>{new Date(r.sharedAt).toLocaleString()}</td>
                  <td>
                    <button className="ghost" onClick={() => downloadSelfRecording(r.id)}>
                      Download
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
