import { nanoid } from 'nanoid';
import * as db from './db.js';

// `filename` stores the R2 object key (e.g. "self-recordings/abc123-clip.webm"),
// not a local disk path -- see server/index.js upload route.
export async function createRecording({ studentId, filename, originalName }) {
  const row = { id: nanoid(10), studentId, filename, originalName, createdAt: Date.now() };
  await db.query(
    `INSERT INTO self_recordings (id, student_id, filename, original_name, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.studentId, row.filename, row.originalName, row.createdAt]
  );
  return row;
}

export async function listForStudent(studentId) {
  const { rows } = await db.query(
    `SELECT sr.*, u.name AS shared_with_name FROM self_recordings sr
     LEFT JOIN users u ON u.id = sr.shared_with_staff_id
     WHERE sr.student_id = $1 ORDER BY sr.created_at DESC`,
    [studentId]
  );
  return rows.map(toPublic);
}

export async function listSharedWithStaff(staffId) {
  const { rows } = await db.query(
    `SELECT sr.*, u.name AS student_name FROM self_recordings sr
     JOIN users u ON u.id = sr.student_id
     WHERE sr.shared_with_staff_id = $1 ORDER BY sr.shared_at DESC`,
    [staffId]
  );
  return rows.map((r) => ({ ...toPublic(r), studentName: r.student_name }));
}

// A superadmin isn't "the staff member it was shared with" for any
// particular recording, so listSharedWithStaff (scoped to one staff
// id) always came back empty for them — there was no view at all for
// what's been shared room-wide, even though getRecordingForDownload
// already lets a superadmin download any of them. This lists every
// share across all students/staff, regardless of who it went to.
export async function listAllShared() {
  const { rows } = await db.query(
    `SELECT sr.*, student.name AS student_name, staff.name AS staff_name
     FROM self_recordings sr
     JOIN users student ON student.id = sr.student_id
     JOIN users staff ON staff.id = sr.shared_with_staff_id
     WHERE sr.shared_with_staff_id IS NOT NULL
     ORDER BY sr.shared_at DESC`
  );
  return rows.map((r) => ({ ...toPublic(r), studentName: r.student_name, staffName: r.staff_name }));
}

async function getRaw(recordingId) {
  const { rows } = await db.query('SELECT * FROM self_recordings WHERE id = $1', [recordingId]);
  return rows[0] || null;
}

// Every student enrolled in any subject this staff member teaches,
// whether as the primary teacher or a co-teacher. This defines both
// who a "share with all my students" broadcast reaches, and the pool
// a staff member can pick a specific student from.
async function getMyStudentIds(staffId) {
  const { rows } = await db.query(
    `SELECT DISTINCT se.student_id
     FROM subject_enrollments se
     JOIN subjects s ON s.id = se.subject_id
     LEFT JOIN subject_teachers st ON st.subject_id = s.id
     WHERE s.staff_id = $1 OR st.staff_id = $1`,
    [staffId]
  );
  return rows.map((r) => r.student_id);
}

export async function listShareableStudents(staffId) {
  const studentIds = await getMyStudentIds(staffId);
  if (studentIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT id, name FROM users WHERE id = ANY($1) AND status = 'approved' ORDER BY name`,
    [studentIds]
  );
  return rows;
}

// Shares a staff/admin-created recording with either specific students
// or every student across the subjects the creator teaches. Only the
// recording's own creator (or a superadmin) can do this -- someone
// this was shared WITH can't turn around and re-share it further.
export async function shareWithStudents(recordingId, actingUser, { studentIds, all }) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  if (actingUser.role !== 'superadmin' && raw.student_id !== actingUser.id) {
    throw new Error('Only the person who made this recording can share it');
  }
  const targets = all ? await getMyStudentIds(raw.student_id) : studentIds || [];
  if (targets.length === 0) {
    throw new Error(all ? "You don't have any students enrolled yet" : 'No students selected');
  }
  const now = Date.now();
  for (const studentId of targets) {
    await db.query(
      `INSERT INTO recording_shares (recording_id, shared_with_id, shared_at)
       VALUES ($1, $2, $3) ON CONFLICT (recording_id, shared_with_id) DO UPDATE SET shared_at = $3`,
      [recordingId, studentId, now]
    );
  }
  return { id: recordingId, sharedWith: targets.length };
}

export async function unshareFromStudent(recordingId, studentId, actingUser) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  if (actingUser.role !== 'superadmin' && raw.student_id !== actingUser.id) {
    throw new Error('Only the person who made this recording can manage its shares');
  }
  await db.query('DELETE FROM recording_shares WHERE recording_id = $1 AND shared_with_id = $2', [
    recordingId,
    studentId,
  ]);
  return { id: recordingId };
}

export async function getShares(recordingId, actingUser) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  if (actingUser.role !== 'superadmin' && raw.student_id !== actingUser.id) {
    throw new Error('Only the person who made this recording can view its shares');
  }
  const { rows } = await db.query(
    `SELECT u.id, u.name FROM recording_shares rs
     JOIN users u ON u.id = rs.shared_with_id
     WHERE rs.recording_id = $1 ORDER BY u.name`,
    [recordingId]
  );
  return rows;
}

// Recordings a staff/admin has shared directly with this student, via
// the multi-recipient mechanism above (separate from a student's own
// self_recordings, and separate from the staff-facing "shared with me"
// view of student -> staff shares).
export async function listSharedWithStudent(studentId) {
  const { rows } = await db.query(
    `SELECT sr.*, u.name AS creator_name FROM recording_shares rs
     JOIN self_recordings sr ON sr.id = rs.recording_id
     JOIN users u ON u.id = sr.student_id
     WHERE rs.shared_with_id = $1 ORDER BY rs.shared_at DESC`,
    [studentId]
  );
  return rows.map((r) => ({ ...toPublic(r), creatorName: r.creator_name }));
}

// A student can only share their own recording, and only to one staff
// member at a time (sharing again just replaces who it's shared with).
export async function shareRecording(recordingId, studentId, staffId) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  if (raw.student_id !== studentId) throw new Error('Not your recording');
  await db.query(
    'UPDATE self_recordings SET shared_with_staff_id = $1, shared_at = $2 WHERE id = $3',
    [staffId, Date.now(), recordingId]
  );
  return { id: recordingId };
}

// Clears the share without touching the recording itself -- the
// student keeps their recording, it just stops showing up for staff.
// Any of: the owning student, the staff member it's currently shared
// with, or a superadmin (who can see/manage every share) can do this.
export async function unshareRecording(recordingId, user) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  const allowed =
    user.role === 'superadmin' ||
    raw.student_id === user.id ||
    (raw.shared_with_staff_id && raw.shared_with_staff_id === user.id);
  if (!allowed) throw new Error('Not permitted');
  await db.query(
    'UPDATE self_recordings SET shared_with_staff_id = NULL, shared_at = NULL WHERE id = $1',
    [recordingId]
  );
  return { id: recordingId };
}

// Owner student, the staff member it's shared with, or a superadmin can
// download it. Anyone else — including other staff it wasn't shared
// with — cannot.
export async function getRecordingForDownload(recordingId, user) {
  const raw = await getRaw(recordingId);
  if (!raw) throw new Error('Recording not found');
  let allowed =
    user.role === 'superadmin' ||
    raw.student_id === user.id ||
    (raw.shared_with_staff_id && raw.shared_with_staff_id === user.id);
  if (!allowed) {
    const { rows } = await db.query(
      'SELECT 1 FROM recording_shares WHERE recording_id = $1 AND shared_with_id = $2',
      [recordingId, user.id]
    );
    allowed = rows.length > 0;
  }
  if (!allowed) throw new Error('Not permitted');
  return { r2Key: raw.filename, originalName: raw.original_name };
}

function toPublic(r) {
  return {
    id: r.id,
    originalName: r.original_name,
    createdAt: Number(r.created_at),
    sharedWithName: r.shared_with_name || null,
    sharedAt: r.shared_at ? Number(r.shared_at) : null,
  };
}
