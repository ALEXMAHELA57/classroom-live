import { nanoid } from 'nanoid';
import * as db from './db.js';
import * as subjects from './subjects.js';
import * as ai from './ai.js';

export function isConfigured() {
  return ai.isConfigured();
}

// Generates an assignment (title, instructions, and a grading rubric —
// the rubric is never shown to students) from a subject's syllabus and/or
// a teacher-provided topic. Saved as a draft — the teacher reviews it
// (and can edit it) before publishing it to students.
export async function generateAssignment({ subjectId, staffId, topic, uploadDir, dueAt }) {
  if (!ai.isConfigured()) throw new Error('Assignment generation is not configured — set ANTHROPIC_API_KEY in .env');

  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');

  const { rows } = await db.query('SELECT * FROM subjects WHERE id = $1', [subjectId]);
  const raw = rows[0];
  const syllabusText = raw
    ? await ai.extractTextFromFile(uploadDir, raw.syllabus_filename, raw.syllabus_mime_type)
    : null;

  if (!syllabusText && !topic) {
    throw new Error('Provide a topic, or upload a PDF/Word syllabus first — there is nothing to generate from');
  }

  const sourceParts = [];
  if (topic) sourceParts.push(`Topic focus requested by the teacher: ${topic}`);
  if (syllabusText) sourceParts.push(`Syllabus content:\n${syllabusText}`);

  const prompt = `You are creating a longer-form assignment (not a quiz) for the subject "${subjectRow.name}".

${sourceParts.join('\n\n')}

Design one substantial assignment — an essay prompt, a problem set, or an applied task — that takes real effort to complete, not a quick question. Students will submit either written text or an uploaded document.

Return ONLY valid JSON, no other text, in exactly this shape:
{
  "title": "short assignment title",
  "instructions": "the full task description shown to students — be specific about what's expected and roughly how long/detailed it should be",
  "rubric": "key points and criteria a grader should check for, used for grading — not shown to students"
}`;

  const response = await ai.anthropic.messages.create({
    model: ai.GENERATION_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text || '';
  let parsed;
  try {
    parsed = ai.extractJson(text);
  } catch {
    console.error('[assignments] failed to parse generated assignment JSON', text);
    throw new Error('The model returned something that could not be parsed as an assignment — try again');
  }
  if (!parsed.title || !parsed.instructions) {
    throw new Error('The generated assignment was incomplete — try again');
  }

  const id = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO assignments (id, subject_id, created_by, title, instructions, rubric, due_at, created_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')`,
    [id, subjectId, staffId, parsed.title, parsed.instructions, parsed.rubric || null, dueAt || null, createdAt]
  );

  return {
    id,
    subjectId,
    title: parsed.title,
    dueAt: dueAt || null,
    usedSyllabus: Boolean(syllabusText),
    status: 'draft',
    createdAt,
  };
}

// Write an assignment by hand — no AI involved. Publishes immediately
// since the teacher authored every word themselves.
export async function createManualAssignment({ subjectId, staffId, title, instructions, rubric, dueAt }) {
  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');
  if (!title || !title.trim()) throw new Error('Title is required');
  if (!instructions || !instructions.trim()) throw new Error('Instructions are required');

  const id = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO assignments (id, subject_id, created_by, title, instructions, rubric, due_at, created_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published')`,
    [id, subjectId, staffId, title.trim(), instructions.trim(), rubric?.trim() || null, dueAt || null, createdAt]
  );

  return { id, subjectId, title: title.trim(), dueAt: dueAt || null, status: 'published', createdAt };
}

// Upload a document that becomes the assignment itself — its extracted
// text becomes the instructions shown to students. Saved as a draft so
// the teacher can review formatting/content (and add a rubric) before
// publishing, since extraction can be imperfect.
export async function createAssignmentFromUpload({ subjectId, staffId, uploadDir, file, title, dueAt }) {
  const subjectRow = await subjects.getSubject(subjectId);
  if (!subjectRow) throw new Error('Subject not found');

  const extractedText = await ai.extractTextFromFile(uploadDir, file.filename, file.mimetype);
  if (!extractedText) {
    throw new Error("Couldn't read text from that file — try a PDF or Word (.docx) file");
  }

  const resolvedTitle = (title && title.trim()) || file.originalname.replace(/\.[^.]+$/, '');

  const id = nanoid(10);
  const createdAt = Date.now();
  await db.query(
    `INSERT INTO assignments
       (id, subject_id, created_by, title, instructions, rubric, due_at, created_at, status,
        source_filename, source_original_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)`,
    [id, subjectId, staffId, resolvedTitle, extractedText, null, dueAt || null, createdAt, file.filename, file.originalname]
  );

  return { id, subjectId, title: resolvedTitle, dueAt: dueAt || null, status: 'draft', createdAt };
}

// Edit an existing assignment — works whether it was generated, uploaded,
// or written by hand. Does not change its published/draft status; use
// publishAssignment for that.
export async function updateAssignment(assignmentId, user, { title, instructions, rubric, dueAt }) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can edit this");
  }
  if (!title || !title.trim()) throw new Error('Title is required');
  if (!instructions || !instructions.trim()) throw new Error('Instructions are required');

  await db.query(
    `UPDATE assignments SET title = $1, instructions = $2, rubric = $3, due_at = $4 WHERE id = $5`,
    [title.trim(), instructions.trim(), rubric?.trim() || null, dueAt || null, assignmentId]
  );

  return {
    id: assignmentId,
    subjectId: raw.subject_id,
    title: title.trim(),
    dueAt: dueAt || null,
    status: raw.status,
    createdAt: Number(raw.created_at),
  };
}

// Approve a draft (generated or uploaded) assignment so students can see it.
export async function publishAssignment(assignmentId, user) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can publish this");
  }
  await db.query("UPDATE assignments SET status = 'published' WHERE id = $1", [assignmentId]);
  return { id: assignmentId, status: 'published' };
}

// Downloads the original file for an upload-based assignment.
export async function getAssignmentSourceFile(assignmentId) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  if (!raw.source_filename) throw new Error('This assignment has no source file');
  return { filename: raw.source_filename, originalName: raw.source_original_name || raw.source_filename };
}

// Students only ever see published assignments. Staff/superadmin see
// everything, including drafts awaiting review.
export async function listAssignmentsForSubject(subjectId, user) {
  const { rows } = await db.query(
    'SELECT id, title, due_at, created_at, status FROM assignments WHERE subject_id = $1 ORDER BY created_at DESC',
    [subjectId]
  );
  const visible = user?.role === 'student' ? rows.filter((r) => r.status === 'published') : rows;
  return visible.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.due_at ? Number(r.due_at) : null,
    status: r.status,
    createdAt: Number(r.created_at),
  }));
}

async function getRawAssignment(assignmentId) {
  const { rows } = await db.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
  return rows[0] || null;
}

// Student view: title + instructions, never the rubric. Includes their
// submission (with score/feedback) if they've already submitted.
export async function getAssignmentForStudent(assignmentId, studentId) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  // Drafts aren't visible to students at all, even by direct link — the
  // teacher hasn't approved them yet.
  if (raw.status !== 'published') throw new Error('Assignment not found');
  const submission = await getSubmission(assignmentId, studentId);
  return {
    id: raw.id,
    subjectId: raw.subject_id,
    title: raw.title,
    instructions: raw.instructions,
    dueAt: raw.due_at ? Number(raw.due_at) : null,
    createdAt: Number(raw.created_at),
    submission,
  };
}

export async function getAssignmentForOwner(assignmentId, user) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  const subject = await subjects.getSubject(raw.subject_id);
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can view this");
  }
  return {
    id: raw.id,
    subjectId: raw.subject_id,
    title: raw.title,
    instructions: raw.instructions,
    rubric: raw.rubric,
    dueAt: raw.due_at ? Number(raw.due_at) : null,
    status: raw.status,
    createdAt: Number(raw.created_at),
  };
}

// Accepts a text answer and/or an uploaded file. If a file is given and
// its text can be extracted (PDF/.docx), that text is what actually gets
// graded — same extraction path used for syllabi. An unsupported file
// type still gets stored (so the teacher can open it manually) but won't
// contribute to the AI grade.
export async function submitAssignment(assignmentId, studentId, { textAnswer, file, uploadDir }) {
  const raw = await getRawAssignment(assignmentId);
  if (!raw) throw new Error('Assignment not found');
  if (raw.status !== 'published') throw new Error('Assignment not found');
  const existing = await getSubmission(assignmentId, studentId);
  if (existing) throw new Error('You already submitted this assignment');

  let fileText = null;
  if (file) {
    fileText = await ai.extractTextFromFile(uploadDir, file.filename, file.mimetype);
  }

  const combinedAnswer = [textAnswer, fileText].filter(Boolean).join('\n\n');
  if (!combinedAnswer.trim()) {
    throw new Error(
      file
        ? "Couldn't read text from that file for grading — try pasting your answer as text instead, or use a PDF/Word (.docx) file"
        : 'Write an answer or attach a file before submitting'
    );
  }

  const graded = await ai.gradeFreeText({ prompt: raw.instructions, rubric: raw.rubric, answer: combinedAnswer });

  const id = nanoid(10);
  await db.query(
    `INSERT INTO assignment_submissions
       (id, assignment_id, student_id, text_answer, file_filename, file_original_name, score, feedback, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      assignmentId,
      studentId,
      textAnswer || null,
      file?.filename || null,
      file?.originalname || null,
      graded.score,
      graded.feedback,
      Date.now(),
    ]
  );

  return { id, score: graded.score, feedback: graded.feedback, submittedAt: Date.now() };
}

export async function getSubmission(assignmentId, studentId) {
  const { rows } = await db.query(
    'SELECT * FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2',
    [assignmentId, studentId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    textAnswer: r.text_answer,
    fileOriginalName: r.file_original_name,
    score: Number(r.score),
    feedback: r.feedback,
    submittedAt: Number(r.submitted_at),
  };
}

export async function listSubmissionsForAssignment(assignmentId) {
  const { rows } = await db.query(
    `SELECT asub.*, u.name AS student_name FROM assignment_submissions asub
     JOIN users u ON u.id = asub.student_id
     WHERE asub.assignment_id = $1 ORDER BY asub.submitted_at DESC`,
    [assignmentId]
  );
  return rows.map((r) => ({
    studentName: r.student_name,
    score: Number(r.score),
    feedback: r.feedback,
    submittedAt: Number(r.submitted_at),
  }));
}
