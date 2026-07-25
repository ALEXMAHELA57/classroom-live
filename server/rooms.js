import { nanoid } from 'nanoid';
import * as db from './db.js';

function toPublicRoom(row) {
  return {
    id: row.id,
    name: row.name,
    hostUserId: row.host_user_id,
    createdAt: Number(row.created_at),
    endsAt: row.ends_at ? Number(row.ends_at) : null,
    ended: row.ended,
    subjectId: row.subject_id || null,
  };
}

export async function createRoom({ name, hostUserId, endsAt, subjectId }) {
  const row = {
    id: nanoid(8),
    name,
    hostUserId,
    createdAt: Date.now(),
    endsAt: endsAt || null,
    subjectId: subjectId || null,
  };
  await db.query(
    `INSERT INTO rooms (id, name, host_user_id, created_at, ends_at, ended, subject_id)
     VALUES ($1, $2, $3, $4, $5, false, $6)`,
    [row.id, row.name, row.hostUserId, row.createdAt, row.endsAt, row.subjectId]
  );
  return toPublicRoom({
    id: row.id,
    name: row.name,
    host_user_id: row.hostUserId,
    created_at: row.createdAt,
    ends_at: row.endsAt,
    ended: false,
    subject_id: row.subjectId,
  });
}

export async function getRoom(id) {
  const { rows } = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
  return rows[0] ? toPublicRoom(rows[0]) : null;
}

// Every session ever started for a subject — this is what lets a
// teacher get back to a past class to check its attendance or
// recordings, since there's otherwise no way to rediscover a room's URL
// once the live session itself has ended.
export async function listRoomsForSubject(subjectId) {
  const { rows } = await db.query(
    'SELECT * FROM rooms WHERE subject_id = $1 ORDER BY created_at DESC',
    [subjectId]
  );
  return rows.map(toPublicRoom);
}

export async function markRoomEnded(id) {
  await db.query('UPDATE rooms SET ended = true WHERE id = $1', [id]);
}

// Rooms with a time limit that hasn't passed and haven't ended yet —
// queried once at server startup so time-limit timers survive a restart
// instead of silently vanishing along with the old in-memory timer.
export async function listActiveTimedRooms() {
  const { rows } = await db.query(
    'SELECT * FROM rooms WHERE ended = false AND ends_at IS NOT NULL AND ends_at > $1',
    [Date.now()]
  );
  return rows.map(toPublicRoom);
}

// Records the first time a student joins a room — safe to call on every
// join or reconnect, since ON CONFLICT keeps only the first join time
// per student. Used to derive present/absent against a subject's roster.
export async function recordAttendance(roomId, studentId) {
  await db.query(
    `INSERT INTO room_attendance (id, room_id, student_id, joined_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (room_id, student_id) DO NOTHING`,
    [nanoid(10), roomId, studentId, Date.now()]
  );
}

// Compares a room's actual joiners against its linked subject's roster.
// A room with no subject_id has no roster to compare against, so
// attendance isn't meaningful for it.
export async function getAttendance(roomId) {
  const room = await getRoom(roomId);
  if (!room) throw new Error('Room not found');
  if (!room.subjectId) return { hasSubject: false, present: [], absent: [] };

  const { rows: enrolledRows } = await db.query(
    `SELECT u.id, u.name, u.email
     FROM subject_enrollments se
     JOIN users u ON u.id = se.student_id
     WHERE se.subject_id = $1
     ORDER BY u.name`,
    [room.subjectId]
  );
  const { rows: attendanceRows } = await db.query(
    'SELECT student_id, joined_at FROM room_attendance WHERE room_id = $1',
    [roomId]
  );
  const joinedMap = new Map(attendanceRows.map((r) => [r.student_id, Number(r.joined_at)]));

  const present = [];
  const absent = [];
  for (const s of enrolledRows) {
    if (joinedMap.has(s.id)) {
      present.push({ id: s.id, name: s.name, email: s.email, joinedAt: joinedMap.get(s.id) });
    } else {
      absent.push({ id: s.id, name: s.name, email: s.email });
    }
  }
  return { hasSubject: true, present, absent };
}

export async function addRoomFile(roomId, { filename, originalName, sizeBytes, uploadedBy }) {
  const row = {
    id: nanoid(10),
    filename,
    originalName,
    sizeBytes,
    uploadedBy,
    uploadedAt: Date.now(),
  };
  await db.query(
    `INSERT INTO room_files (id, room_id, filename, original_name, size_bytes, uploaded_by, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, roomId, row.filename, row.originalName, row.sizeBytes, row.uploadedBy, row.uploadedAt]
  );
  return row;
}

export async function listRoomFiles(roomId) {
  const { rows } = await db.query(
    'SELECT * FROM room_files WHERE room_id = $1 ORDER BY uploaded_at ASC',
    [roomId]
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    originalName: r.original_name,
    sizeBytes: Number(r.size_bytes),
    uploadedBy: r.uploaded_by,
    uploadedAt: Number(r.uploaded_at),
  }));
}

export async function getRoomFile(roomId, fileId) {
  const { rows } = await db.query(
    'SELECT * FROM room_files WHERE room_id = $1 AND id = $2',
    [roomId, fileId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    filename: r.filename,
    originalName: r.original_name,
    sizeBytes: Number(r.size_bytes),
    uploadedBy: r.uploaded_by,
    uploadedAt: Number(r.uploaded_at),
  };
}
