import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getQuizFull, createManualQuiz, updateQuiz, publishQuiz } from '../lib/api.js';
import TopBar from './TopBar.jsx';

function emptyQuestion() {
  return { type: 'mcq', prompt: '', options: ['', '', '', ''], correctAnswer: '', rubric: '' };
}

export default function QuizEditor() {
  const { subjectId, quizId } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(quizId);
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState(isEdit ? [] : [emptyQuestion()]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) return;
    getQuizFull(quizId)
      .then((data) => {
        setTopic(data.quiz.topic || '');
        setQuestions(data.quiz.questions.map((q) => ({ ...q, options: q.options || ['', '', '', ''] })));
        setStatus(data.quiz.status || 'published');
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [isEdit, quizId]);

  function updateQuestion(i, patch) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function addQuestion() {
    setQuestions((qs) => [...qs, emptyQuestion()]);
  }
  function removeQuestion(i) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }

  async function save(andPublish) {
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await updateQuiz(quizId, questions);
        if (andPublish) await publishQuiz(quizId);
      } else {
        await createManualQuiz(subjectId, { topic, questions });
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
      <TopBar title="Quiz" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>{isEdit ? 'Edit quiz' : 'Write a quiz'}</h1>
        {isEdit && status === 'draft' && (
          <p className="muted" style={{ marginBottom: '1rem' }}>
            This quiz is a <strong>draft</strong> — students can't see it yet. Review the
            questions below, make any edits you want, then publish it when you're happy with it.
          </p>
        )}
        {error && <p className="error">{error}</p>}

        {!isEdit && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <label htmlFor="topic">Topic (optional label, shown in the quiz list)</label>
            <input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
        )}

        {questions.map((q, i) => (
          <div className="card subject-card" key={i}>
            <div className="admin-create-form">
              <select value={q.type} onChange={(e) => updateQuestion(i, { type: e.target.value })}>
                <option value="mcq">Multiple choice</option>
                <option value="true_false">True/False</option>
                <option value="short_answer">Short answer</option>
                <option value="scenario">Scenario</option>
              </select>
              <button className="ghost" onClick={() => removeQuestion(i)} disabled={questions.length <= 1}>
                Remove question
              </button>
            </div>
            <textarea
              className="quiz-textarea"
              rows={q.type === 'scenario' ? 4 : 2}
              placeholder={q.type === 'scenario' ? 'Scenario description plus question' : 'Question prompt'}
              value={q.prompt}
              onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
            />

            {q.type === 'mcq' && (
              <>
                {q.options.map((opt, oi) => (
                  <input
                    key={oi}
                    placeholder={`Option ${oi + 1}`}
                    value={opt}
                    onChange={(e) => {
                      const opts = [...q.options];
                      opts[oi] = e.target.value;
                      updateQuestion(i, { options: opts });
                    }}
                    style={{ marginBottom: 6 }}
                  />
                ))}
                <input
                  placeholder="Correct answer (must match one option exactly)"
                  value={q.correctAnswer || ''}
                  onChange={(e) => updateQuestion(i, { correctAnswer: e.target.value })}
                />
              </>
            )}

            {q.type === 'true_false' && (
              <select value={q.correctAnswer || ''} onChange={(e) => updateQuestion(i, { correctAnswer: e.target.value })}>
                <option value="">Correct answer…</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            )}

            {(q.type === 'short_answer' || q.type === 'scenario') && (
              <textarea
                className="quiz-textarea"
                rows={2}
                placeholder="Grading rubric — key points a correct answer should include"
                value={q.rubric || ''}
                onChange={(e) => updateQuestion(i, { rubric: e.target.value })}
              />
            )}
          </div>
        ))}

        <button className="ghost" onClick={addQuestion} style={{ marginBottom: 14 }}>
          + Add question
        </button>
        <br />
        {isEdit && status === 'draft' ? (
          <>
            <button onClick={() => save(false)} disabled={saving || publishing}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>{' '}
            <button onClick={() => save(true)} disabled={saving || publishing}>
              {saving ? 'Saving…' : 'Save & publish to students'}
            </button>
          </>
        ) : isEdit ? (
          <>
            <button onClick={() => save(false)} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>{' '}
            <span className="muted">Already published — students can see this quiz.</span>
          </>
        ) : (
          <button onClick={() => save(false)} disabled={saving}>
            {saving ? 'Saving…' : 'Save quiz'}
          </button>
        )}
      </div>
    </div>
  );
}
