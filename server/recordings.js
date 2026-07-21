import { nanoid } from 'nanoid';
import * as db from './db.js';

function toPublicRecording(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    status: row.status,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at ? Number(row.ended_at) : null,
  };
}

export async function startRecording(roomId, egressId, s3Key) {
  const row = { id: nanoid(10), roomId, egressId, s3Key, startedAt: Date.now() };
  await db.query(
    `INSERT INTO room_recordings (id, room_id, egress_id, s3_key, status, started_at)
     VALUES ($1, $2, $3, $4, 'recording', $5)`,
    [row.id, row.roomId, row.egressId, row.s3Key, row.startedAt]
  );
  return row.id;
}

export async function markRecordingStatus(egressId, status) {
  await db.query(
    'UPDATE room_recordings SET status = $1, ended_at = $2 WHERE egress_id = $3',
    [status, Date.now(), egressId]
  );
}

export async function listRecordings(roomId) {
  const { rows } = await db.query(
    "SELECT * FROM room_recordings WHERE room_id = $1 AND status = 'completed' ORDER BY started_at DESC",
    [roomId]
  );
  return rows.map(toPublicRecording);
}

export async function getRecording(roomId, recordingId) {
  const { rows } = await db.query(
    'SELECT * FROM room_recordings WHERE room_id = $1 AND id = $2',
    [roomId, recordingId]
  );
  if (!rows[0]) return null;
  return { ...toPublicRecording(rows[0]), s3Key: rows[0].s3_key };
}
