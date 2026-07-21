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
  };
}

export async function createRoom({ name, hostUserId, endsAt }) {
  const row = { id: nanoid(8), name, hostUserId, createdAt: Date.now(), endsAt: endsAt || null };
  await db.query(
    `INSERT INTO rooms (id, name, host_user_id, created_at, ends_at, ended)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [row.id, row.name, row.hostUserId, row.createdAt, row.endsAt]
  );
  return toPublicRoom({
    id: row.id,
    name: row.name,
    host_user_id: row.hostUserId,
    created_at: row.createdAt,
    ends_at: row.endsAt,
    ended: false,
  });
}

export async function getRoom(id) {
  const { rows } = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
  return rows[0] ? toPublicRoom(rows[0]) : null;
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
