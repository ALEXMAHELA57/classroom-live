import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getQuizSubmissions } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function QuizResults() {
  const { quizId } = useParams();
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getQuizSubmissions(quizId)
      .then((data) => setSubmissions(data.submissions))
      .catch((err) => setError(err.message));
  }, [quizId]);

  return (
    <div className="page">
      <TopBar title="Quiz results" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>Quiz results</h1>
        {error && <p className="error">{error}</p>}
        {submissions.length === 0 && !error && <p className="muted">No submissions yet.</p>}
        {submissions.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Score</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, i) => (
                <tr key={i}>
                  <td>{s.studentName}</td>
                  <td>{s.score}/100</td>
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
