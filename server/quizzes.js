import { nanoid } from 'nanoid';
import * as db from './db.js';
import * as subjects from './subjects.js';
import * as ai from './ai.js';

export function isConfigured() {
  return ai.isConfigured();
}

// Generates a mixed-format quiz (multiple choice, true/false, short
// answer, and scenario-based questions) from a subject's syllabus text
// and/or a teacher-provided topic. Saved as a draft — the teacher reviews
// it (and can edit it) before publishing it to students.
export async function generateQuiz({ subjectId, staffId, topic, uploadDir, questionCount = 6 }) {
  if (!ai.isConfigured()) throw new Error('Quiz generation is not configured — set ANTHROPIC_API_KEY in .env');

  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');

  // getSubject() only returns the public shape (hasSyllabus boolean) — the
  // actual filename/mime type needed for extraction requires the raw row.
  const { rows } = await db.query('SELECT * FROM subjects WHERE id = $1', [subjectId]);
  const raw = rows[0];
  const actualSyllabusText = raw
    ? await ai.extractTextFromFile(uploadDir, raw.syllabus_filename, raw.syllabus_mime_type)
    : null;

  if (!actualSyllabusText && !topic) {
    throw new Error('Provide a topic, or upload a PDF/Word syllabus first — there is nothing to generate from');
  }

  const sourceParts = [];
  if (topic) sourceParts.push(`Topic focus requested by the teacher: ${topic}`);
  if (actualSyllabusText) sourceParts.push(`Syllabus content:\n${actualSyllabusText}`);

  const prompt = `You are creating a quiz for the subject "${subjectRow.name}".

${sourceParts.join('\n\n')}

Generate exactly ${questionCount} quiz questions with a MIX of these types — include at least one scenario question:
- "mcq": multiple choice, 4 options
- "true_false": a statement to mark true or false
- "short_answer": a brief factual question, 1-2 sentences expected
- "scenario": a short realistic scenario/case description followed by a question testing applied understanding, not just recall

Return ONLY valid JSON, no other text, in exactly this shape:
{
  "questions": [
    {
      "type": "mcq",
      "prompt": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correctAnswer": "option A"
    },
    {
      "type": "true_false",
      "prompt": "statement text",
      "correctAnswer": "true"
    },
    {
      "type": "short_answer",
      "prompt": "question text",
      "rubric": "key points a correct answer should include, for grading"
    },
    {
      "type": "scenario",
      "prompt": "scenario description plus question",
      "rubric": "key points a correct answer should include, for grading"
    }
  ]
}`;

  const response = await ai.anthropic.messages.create({
    model: ai.GENERATION_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text || '';
  let parsed;
  try {
    parsed = ai.extractJson(text);
  } catch {
    console.error('[quizzes] failed to parse generated quiz JSON', text);
    throw new Error('The model returned something that could not be parsed as a quiz — try again');
  }

  const questions = (parsed.questions || []).map((q) => ({ id: nanoid(8), ...q }));
  if (questions.length === 0) throw new Error('No questions were generated');

  const quizId = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO quizzes (id, subject_id, created_by, topic, questions, created_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
    [quizId, subjectId, staffId, topic || null, JSON.stringify(questions), createdAt]
  );

  return {
    id: quizId,
    subjectId,
    topic: topic || null,
    questionCount: questions.length,
    usedSyllabus: Boolean(actualSyllabusText),
    status: 'draft',
    createdAt,
  };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('A quiz needs at least one question');
  }
  const validTypes = ['mcq', 'true_false', 'short_answer', 'scenario'];
  for (const q of questions) {
    if (!validTypes.includes(q.type)) throw new Error(`Unknown question type: ${q.type}`);
    if (!q.prompt || !q.prompt.trim()) throw new Error('Every question needs a prompt');
    if (q.type === 'mcq') {
      const options = (q.options || []).filter((o) => o && o.trim());
      if (options.length < 2) throw new Error('Multiple choice questions need at least 2 options');
      if (!q.correctAnswer || !options.includes(q.correctAnswer)) {
        throw new Error('Multiple choice questions need a correct answer matching one option');
      }
    }
    if (q.type === 'true_false' && !['true', 'false'].includes(q.correctAnswer)) {
      throw new Error('True/false questions need a correct answer of true or false');
    }
  }
}

// Write a quiz by hand — no AI involved. Since the teacher authored every
// word themselves, this publishes immediately rather than sitting in
// draft for review.
export async function createManualQuiz({ subjectId, staffId, topic, questions }) {
  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');

  validateQuestions(questions);
  const cleanQuestions = questions.map((q) => ({ id: q.id || nanoid(8), ...q }));

  const quizId = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO quizzes (id, subject_id, created_by, topic, questions, created_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'published')`,
    [quizId, subjectId, staffId, topic || null, JSON.stringify(cleanQuestions), createdAt]
  );

  return {
    id: quizId,
    subjectId,
    topic: topic || null,
    questionCount: cleanQuestions.length,
    status: 'published',
    createdAt,
  };
}

// Upload an already-written quiz document (PDF/Word) — the model
// structures it into questions rather than inventing new content, but
// since it's still AI-touched (parsing can go wrong), this is saved as a
// draft for the teacher to review before publishing, same as generateQuiz.
export async function generateQuizFromUpload({ subjectId, staffId, uploadDir, file }) {
  if (!ai.isConfigured()) throw new Error('Quiz generation is not configured — set ANTHROPIC_API_KEY in .env');

  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');

  const extractedText = await ai.extractTextFromFile(uploadDir, file.filename, file.mimetype);
  if (!extractedText) {
    throw new Error("Couldn't read text from that file — try a PDF or Word (.docx) file");
  }

  const prompt = `The following is a quiz document a teacher already wrote for the subject "${subjectRow.name}". Convert it into structured JSON — do not invent new questions, just faithfully structure what's here. If a question's type is ambiguous, infer the closest match.

Document content:
${extractedText}

Return ONLY valid JSON, no other text, in exactly this shape:
{
  "questions": [
    { "type": "mcq", "prompt": "...", "options": ["...", "...", "...", "..."], "correctAnswer": "..." },
    { "type": "true_false", "prompt": "...", "correctAnswer": "true" },
    { "type": "short_answer", "prompt": "...", "rubric": "..." },
    { "type": "scenario", "prompt": "...", "rubric": "..." }
  ]
}`;

  const response = await ai.anthropic.messages.create({
    model: ai.GENERATION_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text || '';
  let parsed;
  try {
    parsed = ai.extractJson(text);
  } catch {
    console.error('[quizzes] failed to parse uploaded quiz JSON', text);
    throw new Error("The uploaded document couldn't be structured into a quiz — try again or write it by hand");
  }
  const questions = (parsed.questions || []).map((q) => ({ id: nanoid(8), ...q }));
  if (questions.length === 0) throw new Error('No questions could be found in that document');

  const quizId = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO quizzes
       (id, subject_id, created_by, topic, questions, created_at, status, source_filename, source_original_name)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)`,
    [quizId, subjectId, staffId, null, JSON.stringify(questions), createdAt, file.filename, file.originalname]
  );

  return {
    id: quizId,
    subjectId,
    questionCount: questions.length,
    status: 'draft',
    createdAt,
  };
}

// Edit an existing quiz's questions — works whether it was generated,
// uploaded, or written by hand. Does not change its published/draft
// status; use publishQuiz for that.
export async function updateQuiz(quizId, user, questions) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can edit this");
  }
  validateQuestions(questions);
  const cleanQuestions = questions.map((q) => ({ id: q.id || nanoid(8), ...q }));

  await db.query('UPDATE quizzes SET questions = $1 WHERE id = $2', [JSON.stringify(cleanQuestions), quizId]);

  return {
    id: quizId,
    subjectId: raw.subject_id,
    topic: raw.topic,
    questionCount: cleanQuestions.length,
    status: raw.status,
    createdAt: Number(raw.created_at),
  };
}

// Approve a draft (generated or uploaded) quiz so students can see it.
export async function publishQuiz(quizId, user) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can publish this");
  }
  await db.query("UPDATE quizzes SET status = 'published' WHERE id = $1", [quizId]);
  return { id: quizId, status: 'published' };
}

// Pull a published quiz back to draft — e.g. a mistake was noticed after
// publishing. Any submissions students already made are left alone.
export async function unpublishQuiz(quizId, user) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can unpublish this");
  }
  await db.query("UPDATE quizzes SET status = 'draft' WHERE id = $1", [quizId]);
  return { id: quizId, status: 'draft' };
}

// Deletes the quiz and, via ON DELETE CASCADE, any student submissions
// for it.
export async function deleteQuiz(quizId, user) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can delete this");
  }
  await db.query('DELETE FROM quizzes WHERE id = $1', [quizId]);
  return { id: quizId, deleted: true };
}

function stripAnswers(questions) {
  return questions.map(({ correctAnswer, rubric, ...rest }) => rest);
}

// Students only ever see published quizzes. Staff/superadmin see
// everything, including drafts awaiting review, so they can find and
// approve them.
export async function listQuizzesForSubject(subjectId, user) {
  const { rows } = await db.query(
    'SELECT id, topic, questions, created_at, status FROM quizzes WHERE subject_id = $1 ORDER BY created_at DESC',
    [subjectId]
  );
  const visible = user?.role === 'student' ? rows.filter((r) => r.status === 'published') : rows;
  return visible.map((r) => ({
    id: r.id,
    topic: r.topic,
    questionCount: r.questions.length,
    status: r.status,
    createdAt: Number(r.created_at),
  }));
}

async function getRawQuiz(quizId) {
  const { rows } = await db.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
  return rows[0] || null;
}

// Student view: strips correct answers/rubrics unless they've already
// submitted, in which case their graded result is attached instead.
export async function getQuizForStudent(quizId, studentId) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  // Drafts aren't visible to students at all, even by direct link — the
  // teacher hasn't approved them yet.
  if (raw.status !== 'published') throw new Error('Quiz not found');
  const submission = await getSubmission(quizId, studentId);
  return {
    id: raw.id,
    subjectId: raw.subject_id,
    topic: raw.topic,
    createdAt: Number(raw.created_at),
    questions: submission ? raw.questions : stripAnswers(raw.questions),
    submission,
  };
}

// Teacher view: always includes answers/rubrics, since they authored (or
// at least own) the quiz.
export async function getQuizForOwner(quizId, user) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can view this");
  }
  return {
    id: raw.id,
    subjectId: raw.subject_id,
    topic: raw.topic,
    createdAt: Number(raw.created_at),
    status: raw.status,
    questions: raw.questions,
  };
}

function gradeObjective(question, answer) {
  const correct = String(question.correctAnswer || '').trim().toLowerCase();
  const given = String(answer || '').trim().toLowerCase();
  return correct === given ? 100 : 0;
}

export async function submitQuiz(quizId, studentId, answers) {
  const raw = await getRawQuiz(quizId);
  if (!raw) throw new Error('Quiz not found');
  if (raw.status !== 'published') throw new Error('Quiz not found');
  const existing = await getSubmission(quizId, studentId);
  if (existing) throw new Error('You already submitted this quiz');

  const perQuestion = [];
  for (const q of raw.questions) {
    const answer = answers[q.id] ?? '';
    if (q.type === 'mcq' || q.type === 'true_false') {
      perQuestion.push({ questionId: q.id, score: gradeObjective(q, answer), feedback: null });
    } else {
      const graded = await ai.gradeFreeText({ prompt: q.prompt, rubric: q.rubric, answer });
      perQuestion.push({ questionId: q.id, score: graded.score, feedback: graded.feedback });
    }
  }
  const score = perQuestion.length
    ? Math.round(perQuestion.reduce((sum, p) => sum + p.score, 0) / perQuestion.length)
    : 0;

  const id = nanoid(10);
  await db.query(
    `INSERT INTO quiz_submissions (id, quiz_id, student_id, answers, per_question, score, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, quizId, studentId, JSON.stringify(answers), JSON.stringify(perQuestion), score, Date.now()]
  );

  return { id, score, perQuestion, submittedAt: Date.now() };
}

export async function getSubmission(quizId, studentId) {
  const { rows } = await db.query(
    'SELECT * FROM quiz_submissions WHERE quiz_id = $1 AND student_id = $2',
    [quizId, studentId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    score: Number(r.score),
    answers: r.answers,
    perQuestion: r.per_question,
    submittedAt: Number(r.submitted_at),
  };
}

export async function listSubmissionsForQuiz(quizId) {
  const { rows } = await db.query(
    `SELECT qs.*, u.name AS student_name FROM quiz_submissions qs
     JOIN users u ON u.id = qs.student_id
     WHERE qs.quiz_id = $1 ORDER BY qs.submitted_at DESC`,
    [quizId]
  );
  return rows.map((r) => ({
    studentName: r.student_name,
    score: Number(r.score),
    submittedAt: Number(r.submitted_at),
  }));
}
