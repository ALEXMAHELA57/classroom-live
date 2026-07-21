import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import TopBar from './TopBar.jsx';
import {
  listSubjects,
  createSubject,
  listStudents,
  enrollStudent,
  unenrollStudent,
  uploadSyllabus,
  setSyllabusText,
  generateQuiz,
  listQuizzes,
  uploadQuizFile,
  publishQuiz,
  generateAssignment,
  listAssignments,
  uploadAssignmentFile,
  publishAssignment,
} from '../lib/api.js';

export default function Subjects() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [error, setError] = useState('');

  const canManage = user?.role === 'staff' || user?.role === 'superadmin';

  async function refresh() {
    try {
      const data = await listSubjects();
      setSubjects(data.subjects);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/subjects');
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading || !user) return null;

  return (
    <div className="page">
      <TopBar title="Subjects" backTo="/" />
      <div className="admin-wrap">
        <h1>Subjects</h1>
        {error && <p className="error">{error}</p>}

        {canManage ? (
          <>
            <CreateSubjectForm onCreated={refresh} />
            {subjects.length === 0 && <p className="muted">No subjects yet.</p>}
            {subjects.map((s) => (
              <SubjectManageCard key={s.id} subject={s} onChanged={refresh} />
            ))}
          </>
        ) : (
          <>
            {subjects.length === 0 && (
              <p className="muted">You're not enrolled in any subjects yet.</p>
            )}
            {subjects.map((s) => (
              <StudentSubjectCard key={s.id} subject={s} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function CreateSubjectForm({ onCreated }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await createSubject(name);
      setName('');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <form className="card admin-create" onSubmit={submit}>
      <h3>Create a subject</h3>
      <div className="admin-create-form">
        <input placeholder="e.g. Algebra II" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function StudentSubjectCard({ subject }) {
  const [quizList, setQuizList] = useState([]);
  const [assignmentList, setAssignmentList] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      listQuizzes(subject.id)
        .then((data) => setQuizList(data.quizzes))
        .catch(() => {});
      listAssignments(subject.id)
        .then((data) => setAssignmentList(data.assignments))
        .catch(() => {});
    }
  }, [open, subject.id]);

  return (
    <div className="card subject-card">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        {subject.name} {open ? '▾' : '▸'}
      </h3>
      <p className="muted">Taught by {subject.staffName}</p>
      {open && (
        <>
          {subject.hasSyllabus ? (
            <Link to={`/subjects/${subject.id}/syllabus`}>
              <button>View syllabus</button>
            </Link>
          ) : (
            <p className="muted">No syllabus uploaded yet.</p>
          )}

          <p className="muted" style={{ marginTop: 14 }}>Quizzes</p>
          {quizList.length === 0 && <p className="muted">No quizzes yet.</p>}
          <ul className="roster-list">
            {quizList.map((q) => (
              <li key={q.id} className="file-row">
                <span>{q.topic || 'Quiz'} — {q.questionCount} questions</span>
                <Link to={`/quizzes/${q.id}`}>
                  <button className="ghost">Take quiz</button>
                </Link>
              </li>
            ))}
          </ul>

          <p className="muted" style={{ marginTop: 14 }}>Assignments</p>
          {assignmentList.length === 0 && <p className="muted">No assignments yet.</p>}
          <ul className="roster-list">
            {assignmentList.map((a) => (
              <li key={a.id} className="file-row">
                <span>
                  {a.title}
                  {a.dueAt ? ` — due ${new Date(a.dueAt).toLocaleDateString()}` : ''}
                </span>
                <Link to={`/assignments/${a.id}`}>
                  <button className="ghost">Open</button>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SubjectManageCard({ subject, onChanged }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [quizList, setQuizList] = useState([]);
  const [quizTopic, setQuizTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [uploadingQuiz, setUploadingQuiz] = useState(false);
  const [assignmentList, setAssignmentList] = useState([]);
  const [assignmentTopic, setAssignmentTopic] = useState('');
  const [generatingAssignment, setGeneratingAssignment] = useState(false);
  const [uploadingAssignment, setUploadingAssignment] = useState(false);
  const [syllabusText, setSyllabusTextValue] = useState('');
  const [savingSyllabusText, setSavingSyllabusText] = useState(false);

  useEffect(() => {
    if (open) {
      listStudents()
        .then((data) => setStudents(data.students))
        .catch((err) => setError(err.message));
      refreshQuizzes();
      refreshAssignments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function refreshQuizzes() {
    listQuizzes(subject.id)
      .then((data) => setQuizList(data.quizzes))
      .catch(() => {});
  }

  function refreshAssignments() {
    listAssignments(subject.id)
      .then((data) => setAssignmentList(data.assignments))
      .catch(() => {});
  }

  const enrolledIds = new Set(subject.enrolledStudentIds);
  const availableStudents = students.filter((s) => !enrolledIds.has(s.id));

  async function enroll() {
    if (!selected) return;
    try {
      await enrollStudent(subject.id, selected);
      setSelected('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function unenroll(studentId) {
    try {
      await unenrollStudent(subject.id, studentId);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSyllabusUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await uploadSyllabus(subject.id, file);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveSyllabusText(e) {
    e.preventDefault();
    setSavingSyllabusText(true);
    setError('');
    try {
      await setSyllabusText(subject.id, syllabusText);
      setSyllabusTextValue('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSyllabusText(false);
    }
  }

  async function handleGenerateQuiz(e) {
    e.preventDefault();
    setGenerating(true);
    setError('');
    try {
      await generateQuiz(subject.id, { topic: quizTopic });
      setQuizTopic('');
      refreshQuizzes();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleUploadQuiz(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingQuiz(true);
    setError('');
    try {
      await uploadQuizFile(subject.id, file);
      refreshQuizzes();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingQuiz(false);
      e.target.value = '';
    }
  }

  async function handlePublishQuiz(quizId) {
    setError('');
    try {
      await publishQuiz(quizId);
      refreshQuizzes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGenerateAssignment(e) {
    e.preventDefault();
    setGeneratingAssignment(true);
    setError('');
    try {
      await generateAssignment(subject.id, { topic: assignmentTopic });
      setAssignmentTopic('');
      refreshAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingAssignment(false);
    }
  }

  async function handleUploadAssignment(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAssignment(true);
    setError('');
    try {
      await uploadAssignmentFile(subject.id, file);
      refreshAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingAssignment(false);
      e.target.value = '';
    }
  }

  async function handlePublishAssignment(assignmentId) {
    setError('');
    try {
      await publishAssignment(assignmentId);
      refreshAssignments();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card subject-card">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        {subject.name} ({subject.enrolledStudentIds.length} enrolled) {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          {error && <p className="error">{error}</p>}

          <p className="muted" style={{ marginTop: 10 }}>Syllabus</p>
          {subject.hasSyllabus ? (
            <Link to={`/subjects/${subject.id}/syllabus`}>
              <button className="ghost">View current syllabus</button>
            </Link>
          ) : (
            <p className="muted">None uploaded yet.</p>
          )}
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>Upload a file:</p>
          <input type="file" onChange={handleSyllabusUpload} disabled={uploading} style={{ marginTop: 6 }} />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 10 }}>
            …or type it directly (replaces any uploaded file):
          </p>
          <form onSubmit={handleSaveSyllabusText} className="admin-create-form">
            <textarea
              className="quiz-textarea"
              rows={3}
              placeholder="Paste or write the syllabus text here"
              value={syllabusText}
              onChange={(e) => setSyllabusTextValue(e.target.value)}
            />
            <button type="submit" disabled={savingSyllabusText || !syllabusText.trim()}>
              {savingSyllabusText ? 'Saving…' : 'Save syllabus text'}
            </button>
          </form>

          <p className="muted" style={{ marginTop: 14 }}>Enroll a student</p>
          <div className="admin-create-form">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a student…</option>
              {availableStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
            <button onClick={enroll} disabled={!selected}>
              Enroll
            </button>
          </div>

          <ul className="roster-list roster-mod" style={{ marginTop: 10 }}>
            {subject.enrolledStudentIds.length === 0 && <p className="muted">No students enrolled yet.</p>}
            {students
              .filter((s) => enrolledIds.has(s.id))
              .map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  <button className="ghost" onClick={() => unenroll(s.id)}>
                    Unenroll
                  </button>
                </li>
              ))}
          </ul>

          <p className="muted" style={{ marginTop: 14 }}>Quizzes</p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Generated or uploaded quizzes are saved as drafts — review and edit them, then
            publish when you're ready. A quiz you write by hand publishes immediately.
          </p>
          <form onSubmit={handleGenerateQuiz} className="admin-create-form">
            <input
              placeholder="Topic (optional if a PDF syllabus is uploaded)"
              value={quizTopic}
              onChange={(e) => setQuizTopic(e.target.value)}
            />
            <button type="submit" disabled={generating}>
              {generating ? 'Generating…' : 'Generate quiz'}
            </button>
          </form>
          <div className="admin-create-form" style={{ marginTop: 8 }}>
            <Link to={`/subjects/${subject.id}/quizzes/new`}>
              <button className="ghost">Write a quiz by hand</button>
            </Link>
            <label className="ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
              {uploadingQuiz ? 'Uploading…' : 'Upload a quiz document'}
              <input type="file" onChange={handleUploadQuiz} disabled={uploadingQuiz} style={{ display: 'none' }} />
            </label>
          </div>

          <ul className="roster-list" style={{ marginTop: 10 }}>
            {quizList.length === 0 && <p className="muted">No quizzes yet.</p>}
            {quizList.map((q) => (
              <li key={q.id} className="file-row">
                <span>
                  {q.topic || 'Quiz'} — {q.questionCount} questions
                  {q.status === 'draft' && <span className="muted"> · Draft</span>}
                </span>
                <span>
                  {q.status === 'draft' ? (
                    <>
                      <Link to={`/quizzes/${q.id}/edit`}>
                        <button className="ghost">Review & edit</button>
                      </Link>{' '}
                      <button onClick={() => handlePublishQuiz(q.id)}>Publish</button>
                    </>
                  ) : (
                    <>
                      <Link to={`/quizzes/${q.id}/edit`}>
                        <button className="ghost">Edit</button>
                      </Link>{' '}
                      <Link to={`/quizzes/${q.id}/results`}>
                        <button className="ghost">Results</button>
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <p className="muted" style={{ marginTop: 14 }}>Assignments</p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Same review flow as quizzes — generated or uploaded assignments start as drafts;
            hand-written ones publish immediately.
          </p>
          <form onSubmit={handleGenerateAssignment} className="admin-create-form">
            <input
              placeholder="Topic (optional if a PDF syllabus is uploaded)"
              value={assignmentTopic}
              onChange={(e) => setAssignmentTopic(e.target.value)}
            />
            <button type="submit" disabled={generatingAssignment}>
              {generatingAssignment ? 'Generating…' : 'Generate assignment'}
            </button>
          </form>
          <div className="admin-create-form" style={{ marginTop: 8 }}>
            <Link to={`/subjects/${subject.id}/assignments/new`}>
              <button className="ghost">Write an assignment by hand</button>
            </Link>
            <label className="ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
              {uploadingAssignment ? 'Uploading…' : 'Upload an assignment document'}
              <input
                type="file"
                onChange={handleUploadAssignment}
                disabled={uploadingAssignment}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <ul className="roster-list" style={{ marginTop: 10 }}>
            {assignmentList.length === 0 && <p className="muted">No assignments yet.</p>}
            {assignmentList.map((a) => (
              <li key={a.id} className="file-row">
                <span>
                  {a.title}
                  {a.status === 'draft' && <span className="muted"> · Draft</span>}
                </span>
                <span>
                  {a.status === 'draft' ? (
                    <>
                      <Link to={`/assignments/${a.id}/edit`}>
                        <button className="ghost">Review & edit</button>
                      </Link>{' '}
                      <button onClick={() => handlePublishAssignment(a.id)}>Publish</button>
                    </>
                  ) : (
                    <>
                      <Link to={`/assignments/${a.id}/edit`}>
                        <button className="ghost">Edit</button>
                      </Link>{' '}
                      <Link to={`/assignments/${a.id}/results`}>
                        <button className="ghost">Results</button>
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
