import { nanoid } from 'nanoid';
import * as db from './db.js';

function toPublicSubject(row, enrolledStudentIds) {
  return {
    id: row.id,
    name: row.name,
    staffId: row.staff_id,
    staffName: row.staff_name,
    createdAt: Number(row.created_at),
    enrolledStudentIds,
    hasSyllabus: Boolean(row.syllabus_filename) || Boolean(row.syllabus_text),
  };
}

async function getEnrolledIds(subjectId) {
  const { rows } = await db.query(
    'SELECT student_id FROM subject_enrollments WHERE subject_id = $1',
    [subjectId]
  );
  return rows.map((r) => r.student_id);
}

async function getRawSubject(id) {
  const { rows } = await db.query('SELECT * FROM subjects WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createSubject({ name, staffId, staffName }) {
  if (!name) throw new Error('Subject name is required');
  const row = { id: nanoid(10), name, staffId, staffName, createdAt: Date.now() };
  await db.query(
    `INSERT INTO subjects (id, name, staff_id, staff_name, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.name, row.staffId, row.staffName, row.createdAt]
  );
  return toPublicSubject(
    { id: row.id, name: row.name, staff_id: row.staffId, staff_name: row.staffName, created_at: row.createdAt },
    []
  );
}

// Public shape — used for listing, ownership checks, etc.
export async function getSubject(id) {
  const raw = await getRawSubject(id);
  if (!raw) return null;
  return toPublicSubject(raw, await getEnrolledIds(id));
}

// Subjects a given user can see: staff/superadmin see subjects they own
// (or all, for superadmin); students see only subjects they're enrolled in.
export async function listSubjectsFor(user) {
  let rows;
  if (user.role === 'superadmin') {
    ({ rows } = await db.query('SELECT * FROM subjects ORDER BY created_at DESC'));
  } else if (user.role === 'staff') {
    ({ rows } = await db.query(
      'SELECT * FROM subjects WHERE staff_id = $1 ORDER BY created_at DESC',
      [user.id]
    ));
  } else {
    ({ rows } = await db.query(
      `SELECT s.* FROM subjects s
       JOIN subject_enrollments e ON e.subject_id = s.id
       WHERE e.student_id = $1
       ORDER BY s.created_at DESC`,
      [user.id]
    ));
  }
  const results = [];
  for (const row of rows) {
    results.push(toPublicSubject(row, await getEnrolledIds(row.id)));
  }
  return results;
}

export async function enrollStudent(subjectId, studentId) {
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');
  await db.query(
    `INSERT INTO subject_enrollments (subject_id, student_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [subjectId, studentId]
  );
  return toPublicSubject(raw, await getEnrolledIds(subjectId));
}

export async function unenrollStudent(subjectId, studentId) {
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');
  await db.query(
    'DELETE FROM subject_enrollments WHERE subject_id = $1 AND student_id = $2',
    [subjectId, studentId]
  );
  return toPublicSubject(raw, await getEnrolledIds(subjectId));
}

// Uploading a file syllabus clears any previously typed-in text — there's
// one syllabus, not both at once.
export async function setSyllabus(subjectId, fileInfo) {
  const { rows } = await db.query(
    `UPDATE subjects
     SET syllabus_filename = $1, syllabus_original_name = $2, syllabus_mime_type = $3,
         syllabus_uploaded_at = $4, syllabus_text = NULL
     WHERE id = $5 RETURNING *`,
    [fileInfo.filename, fileInfo.originalName, fileInfo.mimeType, fileInfo.uploadedAt, subjectId]
  );
  if (!rows[0]) throw new Error('Subject not found');
  return toPublicSubject(rows[0], await getEnrolledIds(subjectId));
}

// Alternative to uploading a file — type the syllabus directly. Clears
// any previously uploaded file, same mutual-exclusivity rule as above.
export async function setSyllabusText(subjectId, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Syllabus text cannot be empty');
  const { rows } = await db.query(
    `UPDATE subjects
     SET syllabus_text = $1, syllabus_filename = NULL, syllabus_original_name = NULL,
         syllabus_mime_type = NULL, syllabus_uploaded_at = $2
     WHERE id = $3 RETURNING *`,
    [trimmed, Date.now(), subjectId]
  );
  if (!rows[0]) throw new Error('Subject not found');
  return toPublicSubject(rows[0], await getEnrolledIds(subjectId));
}

// Full permission check + file lookup in one call, so callers (index.js)
// don't need to know the internal shape of a subject row. Throws with a
// clear message on any failure — 404 vs 403 distinguished by the caller
// via the error message, since that's all an HTTP handler needs.
export async function getSyllabusForViewing(subjectId, user) {
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');
  if (!raw.syllabus_filename && !raw.syllabus_text) {
    throw new Error('No syllabus uploaded for this subject');
  }

  let allowed = user.role === 'superadmin' || (user.role === 'staff' && raw.staff_id === user.id);
  if (!allowed && user.role === 'student') {
    const enrolledIds = await getEnrolledIds(subjectId);
    allowed = enrolledIds.includes(user.id);
  }
  if (!allowed) throw new Error('Not enrolled in this subject');

  if (raw.syllabus_text) {
    return { type: 'text', text: raw.syllabus_text };
  }
  return {
    type: 'file',
    filename: raw.syllabus_filename,
    originalName: raw.syllabus_original_name,
    mimeType: raw.syllabus_mime_type,
  };
}

// Ownership check used by staff-facing management endpoints (enroll,
// unenroll, upload syllabus). Returns the public subject shape, or throws.
export async function getOwnedSubject(subjectId, user) {
  const subject = await getSubject(subjectId);
  if (!subject) throw new Error('Subject not found');
  if (user.role !== 'superadmin' && subject.staffId !== user.id) {
    throw new Error("Only this subject's teacher can manage it");
  }
  return subject;
}

// Deletes the subject entirely. Enrollments, quizzes, assignments, and
// their submissions all cascade via foreign keys — there's no
// undo, so the route calling this should get explicit confirmation first.
export async function deleteSubject(subjectId, user) {
  await getOwnedSubject(subjectId, user);
  await db.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
  return { id: subjectId, deleted: true };
}
