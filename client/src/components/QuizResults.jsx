import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getQuizSubmissions } from '../lib/api.js';
import TopBar from './TopBar.jsx';

export default function QuizResults() {
  const { quizId } = useParams();
  const [questions, setQuestions] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState('');
  const [openStudent, setOpenStudent] = useState(null);

  useEffect(() => {
    getQuizSubmissions(quizId)
      .then((data) => {
        setQuestions(data.questions || []);
        setSubmissions(data.submissions);
      })
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, i) => {
                const isOpen = openStudent === i;
                return (
                  <Fragment key={i}>
                    <tr>
                      <td>{s.studentName}</td>
                      <td>{s.score}/100</td>
                      <td>{new Date(s.submittedAt).toLocaleString()}</td>
                      <td>
                        <button className="ghost" onClick={() => setOpenStudent(isOpen ? null : i)}>
                          {isOpen ? 'Hide answers' : 'View answers'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4}>
                          <StudentAnswerBreakdown questions={questions} submission={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StudentAnswerBreakdown({ questions, submission }) {
  const perQuestionById = new Map((submission.perQuestion || []).map((p) => [p.questionId, p]));

  return (
    <div className="quiz-answer-breakdown">
      {questions.map((q, idx) => {
        const graded = perQuestionById.get(q.id);
        const given = submission.answers?.[q.id] ?? '';
        const isObjective = q.type === 'mcq' || q.type === 'true_false';
        const correct = graded && graded.score >= 100;

        return (
          <div
            key={q.id}
            className={`quiz-answer-row ${graded ? (correct ? 'quiz-answer-correct' : 'quiz-answer-incorrect') : ''}`}
          >
            <p className="quiz-answer-prompt">
              {idx + 1}. {q.prompt}
            </p>
            <p className="quiz-answer-given">
              <span className="quiz-answer-label">Answered:</span>{' '}
              {given || <span className="muted">(no answer given)</span>}
            </p>
            {isObjective && (
              <p className="quiz-answer-correct-line">
                <span className="quiz-answer-label">Correct answer:</span> {q.correctAnswer}
              </p>
            )}
            {!isObjective && graded?.feedback && (
              <p className="quiz-answer-feedback">
                <span className="quiz-answer-label">Feedback:</span> {graded.feedback}
              </p>
            )}
            {graded && (
              <p className="quiz-answer-score muted">Score for this question: {graded.score}/100</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
