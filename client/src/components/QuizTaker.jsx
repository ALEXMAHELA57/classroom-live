import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getQuiz, submitQuiz } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function QuizTaker() {
  const { quizId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/quizzes/${quizId}`);
      return;
    }
    getQuiz(quizId)
      .then((data) => setQuiz(data.quiz))
      .catch((err) => setError(err.message));
  }, [authLoading, user, quizId]);

  if (authLoading || !user) return null;
  if (error) return <div className="page centered"><div className="card"><p className="error">{error}</p></div></div>;
  if (!quiz) return null;

  const alreadySubmitted = Boolean(quiz.submission);

  function setAnswer(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { result } = await submitQuiz(quizId, answers);
      setQuiz((q) => ({ ...q, submission: result }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="Quiz" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>Quiz{quiz.topic ? `: ${quiz.topic}` : ''}</h1>
        {error && <p className="error">{error}</p>}

        {alreadySubmitted && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3>Your score: {quiz.submission.score}/100</h3>
          </div>
        )}

        <form onSubmit={submit}>
          {quiz.questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i}
              question={q}
              value={answers[q.id] || ''}
              onChange={(v) => setAnswer(q.id, v)}
              result={alreadySubmitted ? quiz.submission.perQuestion.find((p) => p.questionId === q.id) : null}
              submittedAnswer={alreadySubmitted ? quiz.submission.answers[q.id] : null}
              disabled={alreadySubmitted}
            />
          ))}
          {!alreadySubmitted && (
            <button type="submit" disabled={submitting}>
              {submitting ? 'Grading…' : 'Submit quiz'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function QuestionCard({ index, question, value, onChange, result, submittedAnswer, disabled }) {
  return (
    <div className="card subject-card">
      <p className="muted">
        Question {index + 1} · {question.type.replace('_', ' ')}
      </p>
      <p><strong>{question.prompt}</strong></p>

      {question.type === 'mcq' && (
        <div className="quiz-options">
          {question.options?.map((opt) => (
            <label key={opt} className="quiz-option">
              <input
                type="radio"
                name={question.id}
                checked={(disabled ? submittedAnswer : value) === opt}
                onChange={() => onChange(opt)}
                disabled={disabled}
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {question.type === 'true_false' && (
        <div className="quiz-options">
          {['true', 'false'].map((opt) => (
            <label key={opt} className="quiz-option">
              <input
                type="radio"
                name={question.id}
                checked={(disabled ? submittedAnswer : value) === opt}
                onChange={() => onChange(opt)}
                disabled={disabled}
              />
              {opt === 'true' ? 'True' : 'False'}
            </label>
          ))}
        </div>
      )}

      {(question.type === 'short_answer' || question.type === 'scenario') && (
        <textarea
          className="quiz-textarea"
          value={disabled ? submittedAnswer || '' : value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={question.type === 'scenario' ? 4 : 2}
          placeholder="Your answer…"
        />
      )}

      {result && (
        <p className={result.score >= 60 ? 'quiz-feedback-good' : 'quiz-feedback-poor'}>
          {result.score}/100{result.feedback ? ` — ${result.feedback}` : ''}
        </p>
      )}
    </div>
  );
}
