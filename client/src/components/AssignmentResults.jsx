import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAssignmentSubmissions } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function AssignmentResults() {
  const { assignmentId } = useParams();
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getAssignmentSubmissions(assignmentId)
      .then((data) => setSubmissions(data.submissions))
      .catch((err) => setError(err.message));
  }, [assignmentId]);

  return (
    <div className="page">
      <TopBar title="Assignment results" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>Assignment results</h1>
        {error && <p className="error">{error}</p>}
        {submissions.length === 0 && !error && <p className="muted">No submissions yet.</p>}
        {submissions.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Score</th>
                <th>Feedback</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, i) => (
                <tr key={i}>
                  <td>{s.studentName}</td>
                  <td>{s.score}/100</td>
                  <td>{s.feedback}</td>
                  <td>{new Date(s.submittedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
