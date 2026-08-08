import { nanoid } from 'nanoid';
import * as db from './db.js';
import * as auth from './auth.js';

function toPublicSubject(row, enrolledStudentIds, coTeachers = []) {
  return {
    id: row.id,
    name: row.name,
    staffId: row.staff_id,
    staffName: row.staff_name,
    staffVisibleAsEducator: row.visible_as_educator,
    coTeachers,
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

async function getCoTeachers(subjectId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, st.visible_as_educator FROM subject_teachers st
     JOIN users u ON u.id = st.staff_id
     WHERE st.subject_id = $1 ORDER BY st.added_at`,
    [subjectId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibleAsEducator: r.visible_as_educator,
  }));
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
  return toPublicSubject(raw, await getEnrolledIds(id), await getCoTeachers(id));
}

// Subjects a given user can see: staff/superadmin see subjects they own
// or co-teach (or all, for superadmin); students see only subjects
// they're enrolled in.
export async function listSubjectsFor(user) {
  let rows;
  if (user.role === 'superadmin') {
    ({ rows } = await db.query('SELECT * FROM subjects ORDER BY created_at DESC'));
  } else if (user.role === 'staff') {
    ({ rows } = await db.query(
      `SELECT DISTINCT s.* FROM subjects s
       LEFT JOIN subject_teachers st ON st.subject_id = s.id
       WHERE s.staff_id = $1 OR st.staff_id = $1
       ORDER BY s.created_at DESC`,
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
    results.push(toPublicSubject(row, await getEnrolledIds(row.id), await getCoTeachers(row.id)));
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
  if (!allowed && user.role === 'staff') {
    const coTeachers = await getCoTeachers(subjectId);
    allowed = coTeachers.some((t) => t.id === user.id);
  }
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

// True if this user is the subject's original creator OR a co-teacher —
// either way, they get full management rights over it. Exported for
// reuse by quizzes.js and assignments.js, which each have their own
// subject-ownership checks that need the same co-teacher awareness.
export function isSubjectTeacher(subject, userId) {
  return subject.staffId === userId || subject.coTeachers.some((t) => t.id === userId);
}

// Ownership check used by staff-facing management endpoints (enroll,
// unenroll, upload syllabus). Returns the public subject shape, or throws.
export async function getOwnedSubject(subjectId, user) {
  const subject = await getSubject(subjectId);
  if (!subject) throw new Error('Subject not found');
  if (user.role !== 'superadmin' && !isSubjectTeacher(subject, user.id)) {
    throw new Error("Only this subject's teacher can manage it");
  }
  return subject;
}

// Adds a co-teacher. Only a superadmin or the subject's original creator
// can do this — a co-teacher can't yet add further co-teachers of their
// own, keeping one clear point of accountability per subject.
export async function addCoTeacher(subjectId, staffId, actingUser) {
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');
  if (actingUser.role !== 'superadmin' && raw.staff_id !== actingUser.id) {
    throw new Error("Only this subject's teacher or an admin can add co-teachers");
  }
  if (staffId === raw.staff_id) throw new Error('That person already teaches this subject');
  const target = await auth.getUserById(staffId);
  if (!target || target.status !== 'approved' || !['staff', 'superadmin'].includes(target.role)) {
    throw new Error('That person is not an approved staff or admin account');
  }
  await db.query(
    `INSERT INTO subject_teachers (subject_id, staff_id, added_at)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [subjectId, staffId, Date.now()]
  );
  return getSubject(subjectId);
}

export async function removeCoTeacher(subjectId, staffId, actingUser) {
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');
  if (actingUser.role !== 'superadmin' && raw.staff_id !== actingUser.id) {
    throw new Error("Only this subject's teacher or an admin can remove co-teachers");
  }
  await db.query('DELETE FROM subject_teachers WHERE subject_id = $1 AND staff_id = $2', [
    subjectId,
    staffId,
  ]);
  return getSubject(subjectId);
}

// Controls whether a specific staff member shows up on the public
// "Find Educators" page for THIS subject specifically -- purely a
// visibility setting, doesn't touch their actual teaching permissions
// (roster, quizzes, etc). Admin-only by design: this is about how the
// school presents itself publicly, not day-to-day subject management,
// so it's kept separate from the teacher-or-admin rule that governs
// adding/removing co-teachers.
export async function setEducatorVisibility(subjectId, staffId, visible, actingUser) {
  if (actingUser.role !== 'superadmin') {
    throw new Error('Only an admin can control public educator visibility');
  }
  const raw = await getRawSubject(subjectId);
  if (!raw) throw new Error('Subject not found');

  if (staffId === raw.staff_id) {
    await db.query('UPDATE subjects SET visible_as_educator = $1 WHERE id = $2', [
      visible,
      subjectId,
    ]);
  } else {
    const { rowCount } = await db.query(
      'UPDATE subject_teachers SET visible_as_educator = $1 WHERE subject_id = $2 AND staff_id = $3',
      [visible, subjectId, staffId]
    );
    if (rowCount === 0) throw new Error('That person does not teach this subject');
  }
  return getSubject(subjectId);
}

// Deletes the subject entirely. Enrollments, quizzes, assignments, and
// their submissions all cascade via foreign keys — there's no
// undo, so the route calling this should get explicit confirmation first.
export async function deleteSubject(subjectId, user) {
  await getOwnedSubject(subjectId, user);
  await db.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
  return { id: subjectId, deleted: true };
}
