import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getAssignment, submitAssignment } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function AssignmentTaker() {
  const { assignmentId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/assignments/${assignmentId}`);
      return;
    }
    getAssignment(assignmentId)
      .then((data) => setAssignment(data.assignment))
      .catch((err) => setError(err.message));
  }, [authLoading, user, assignmentId]);

  if (authLoading || !user) return null;
  if (error && !assignment) {
    return <div className="page centered"><div className="card"><p className="error">{error}</p></div></div>;
  }
  if (!assignment) return null;

  const alreadySubmitted = Boolean(assignment.submission);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { result } = await submitAssignment(assignmentId, { textAnswer, file });
      setAssignment((a) => ({ ...a, submission: result }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="Assignment" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>{assignment.title}</h1>
        {assignment.dueAt && (
          <p className="muted">Due {new Date(assignment.dueAt).toLocaleString()}</p>
        )}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.instructions}</p>
        </div>

        {error && <p className="error">{error}</p>}

        {alreadySubmitted ? (
          <div className="card">
            <h3>Your score: {assignment.submission.score}/100</h3>
            {assignment.submission.feedback && <p className="muted">{assignment.submission.feedback}</p>}
            {assignment.submission.textAnswer && (
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{assignment.submission.textAnswer}</p>
            )}
            {assignment.submission.fileOriginalName && (
              <p className="muted">Submitted file: {assignment.submission.fileOriginalName}</p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="card">
            <label htmlFor="textAnswer">Your answer</label>
            <textarea
              id="textAnswer"
              className="quiz-textarea"
              rows={8}
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="Write your answer here, or attach a file below (PDF or Word .docx works best for grading)…"
            />
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ marginTop: 10, marginBottom: 14 }}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? 'Grading…' : 'Submit assignment'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
