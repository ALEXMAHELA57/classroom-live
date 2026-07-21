import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAssignmentFull, createManualAssignment, updateAssignment, publishAssignment } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function AssignmentEditor() {
  const { subjectId, assignmentId } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(assignmentId);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [rubric, setRubric] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) return;
    getAssignmentFull(assignmentId)
      .then((data) => {
        setTitle(data.assignment.title);
        setInstructions(data.assignment.instructions);
        setRubric(data.assignment.rubric || '');
        setDueDate(data.assignment.dueAt ? new Date(data.assignment.dueAt).toISOString().slice(0, 10) : '');
        setStatus(data.assignment.status || 'published');
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [isEdit, assignmentId]);

  async function save(e, andPublish) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const dueAt = dueDate ? new Date(dueDate).getTime() : null;
    try {
      if (isEdit) {
        await updateAssignment(assignmentId, { title, instructions, rubric, dueAt });
        if (andPublish) await publishAssignment(assignmentId);
      } else {
        await createManualAssignment(subjectId, { title, instructions, rubric, dueAt });
      }
      navigate('/subjects');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="page">
      <TopBar title="Assignment" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>{isEdit ? 'Edit assignment' : 'Write an assignment'}</h1>
        {isEdit && status === 'draft' && (
          <p className="muted" style={{ marginBottom: '1rem' }}>
            This assignment is a <strong>draft</strong> — students can't see it yet. Review it,
            make any edits you want, then publish it when you're happy with it.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <form onSubmit={(e) => save(e, false)} className="card">
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label htmlFor="instructions">Instructions (shown to students)</label>
          <textarea
            id="instructions"
            className="quiz-textarea"
            rows={8}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />

          <label htmlFor="rubric">Grading rubric (used for grading, not shown to students)</label>
          <textarea
            id="rubric"
            className="quiz-textarea"
            rows={4}
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
          />

          <label htmlFor="dueDate">Due date (optional)</label>
          <input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

          {isEdit && status === 'draft' ? (
            <>
              <button type="submit" disabled={saving} style={{ marginTop: 12 }}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>{' '}
              <button type="button" onClick={(e) => save(e, true)} disabled={saving} style={{ marginTop: 12 }}>
                {saving ? 'Saving…' : 'Save & publish to students'}
              </button>
            </>
          ) : isEdit ? (
            <>
              <button type="submit" disabled={saving} style={{ marginTop: 12 }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>{' '}
              <span className="muted">Already published — students can see this assignment.</span>
            </>
          ) : (
            <button type="submit" disabled={saving} style={{ marginTop: 12 }}>
              {saving ? 'Saving…' : 'Save assignment'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
