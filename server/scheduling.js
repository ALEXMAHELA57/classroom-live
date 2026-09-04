import { nanoid } from 'nanoid';
import * as db from './db.js';
import * as subjects from './subjects.js';
import * as roomsRepo from './rooms.js';

function toPublic(row) {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    hostName: row.host_name,
    subjectId: row.subject_id,
    subjectName: row.subject_name || null,
    title: row.title,
    scheduledAt: Number(row.scheduled_at),
    durationMinutes: row.duration_minutes ? Number(row.duration_minutes) : null,
    allowGuests: Boolean(row.allow_guests),
    roomId: row.room_id || null,
    // Started but not yet ended -- still worth showing in "upcoming"
    // (really "not finished yet") so people can still find the link.
    isLive: Boolean(row.room_id) && row.room_ended === false,
    canceled: row.canceled,
    createdAt: Number(row.created_at),
  };
}

const SELECT_BASE = `
  SELECT sc.*, u.name AS host_name, s.name AS subject_name, r.ended AS room_ended
  FROM scheduled_classes sc
  JOIN users u ON u.id = sc.host_user_id
  LEFT JOIN subjects s ON s.id = sc.subject_id
  LEFT JOIN rooms r ON r.id = sc.room_id
`;

async function getRaw(id) {
  const { rows } = await db.query(`${SELECT_BASE} WHERE sc.id = $1`, [id]);
  return rows[0] || null;
}

export async function getScheduledClass(id) {
  const raw = await getRaw(id);
  return raw ? toPublic(raw) : null;
}

// Deliberately minimal -- same reasoning as rooms.getPublicRoomInfo:
// this has to work for a visitor with no account at all yet, since the
// scheduled-class link is what they'd open before deciding to log in
// or join as a guest.
export async function getPublicScheduledInfo(id) {
  const raw = await getRaw(id);
  if (!raw) return null;
  return {
    title: raw.title,
    scheduledAt: Number(raw.scheduled_at),
    allowGuests: Boolean(raw.allow_guests),
    roomId: raw.room_id || null,
    canceled: raw.canceled,
  };
}

export async function createScheduledClass({
  hostUser,
  subjectId,
  title,
  scheduledAt,
  durationMinutes,
  allowGuests,
}) {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) throw new Error('Title is required');
  if (!scheduledAt || Number(scheduledAt) <= Date.now()) {
    throw new Error('Scheduled time must be in the future');
  }
  let resolvedSubjectId = null;
  if (subjectId) {
    const subject = await subjects.getOwnedSubject(subjectId, hostUser); // ownership check
    resolvedSubjectId = subject.id;
  }
  const row = {
    id: nanoid(10),
    hostUserId: hostUser.id,
    subjectId: resolvedSubjectId,
    title: trimmedTitle,
    scheduledAt: Number(scheduledAt),
    durationMinutes: durationMinutes ? Number(durationMinutes) : null,
    allowGuests: Boolean(allowGuests),
    createdAt: Date.now(),
  };
  await db.query(
    `INSERT INTO scheduled_classes
       (id, host_user_id, subject_id, title, scheduled_at, duration_minutes, allow_guests, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.id,
      row.hostUserId,
      row.subjectId,
      row.title,
      row.scheduledAt,
      row.durationMinutes,
      row.allowGuests,
      row.createdAt,
    ]
  );
  return getScheduledClass(row.id);
}

// Staff/superadmin: their own hosted or co-taught-subject upcoming
// entries. Students: only ones tied to a subject they're enrolled in --
// a standalone (no-subject) scheduled meeting isn't surfaced to anyone,
// same as an ad-hoc no-subject room today: the host shares the link
// directly with whoever needs it.
export async function listUpcomingFor(user) {
  let rows;
  const now = Date.now();
  const staleCutoff = now - 24 * 60 * 60 * 1000; // 24 hours
  // "Upcoming" means: genuinely still ahead of us (not started, and its
  // time hasn't passed), OR started recently and still going. Without
  // the staleCutoff half of this, a class started with no time limit
  // whose host just closed the tab (never explicitly clicking "End",
  // and no time-limit auto-end to catch it) stays room.ended = false
  // forever and would keep showing up indefinitely, however old it is.
  // Without the scheduled_at check on the not-yet-started half, a
  // class whose time came and went without ever being started would
  // linger the same way.
  if (user.role === 'superadmin') {
    ({ rows } = await db.query(
      `${SELECT_BASE}
       WHERE sc.canceled = false
         AND (
           (sc.room_id IS NULL AND sc.scheduled_at > $1)
           OR (sc.room_id IS NOT NULL AND r.ended = false AND r.created_at > $2)
         )
       ORDER BY sc.scheduled_at ASC`,
      [now, staleCutoff]
    ));
  } else if (user.role === 'staff') {
    ({ rows } = await db.query(
      `${SELECT_BASE}
       LEFT JOIN subject_teachers st ON st.subject_id = sc.subject_id
       WHERE sc.canceled = false
         AND (
           (sc.room_id IS NULL AND sc.scheduled_at > $2)
           OR (sc.room_id IS NOT NULL AND r.ended = false AND r.created_at > $3)
         )
         AND (sc.host_user_id = $1 OR st.staff_id = $1)
       ORDER BY sc.scheduled_at ASC`,
      [user.id, now, staleCutoff]
    ));
  } else {
    ({ rows } = await db.query(
      `${SELECT_BASE}
       JOIN subject_enrollments se ON se.subject_id = sc.subject_id
       WHERE sc.canceled = false
         AND (
           (sc.room_id IS NULL AND sc.scheduled_at > $2)
           OR (sc.room_id IS NOT NULL AND r.ended = false AND r.created_at > $3)
         )
         AND se.student_id = $1
       ORDER BY sc.scheduled_at ASC`,
      [user.id, now, staleCutoff]
    ));
  }
  return rows.map(toPublic);
}

// Homepage listing for anonymous visitors. Shows every upcoming class,
// not just guest-enabled ones -- but only guest-enabled ones get an
// actual working link out of this (see allowGuests in the returned
// shape). A subject-tied class still shows its title and time (so
// visitors can see the school is active), but joining it requires an
// account and enrollment, so there's nothing for an anonymous visitor
// to click through to.
export async function listPublicUpcoming() {
  const now = Date.now();
  const staleCutoff = now - 24 * 60 * 60 * 1000; // 24 hours
  const { rows } = await db.query(
    `${SELECT_BASE}
     WHERE sc.canceled = false
       AND (
         (sc.room_id IS NULL AND sc.scheduled_at > $1)
         OR (sc.room_id IS NOT NULL AND r.ended = false AND r.created_at > $2)
       )
     ORDER BY sc.scheduled_at ASC
     LIMIT 20`,
    [now, staleCutoff]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    scheduledAt: Number(r.scheduled_at),
    allowGuests: Boolean(r.allow_guests),
    isLive: Boolean(r.room_id) && r.room_ended === false,
  }));
}

export async function cancelScheduledClass(id, actingUser) {
  const raw = await getRaw(id);
  if (!raw) throw new Error('Scheduled class not found');
  if (actingUser.role !== 'superadmin' && raw.host_user_id !== actingUser.id) {
    throw new Error('Only the host or an admin can cancel this');
  }
  await db.query('UPDATE scheduled_classes SET canceled = true WHERE id = $1', [id]);
}

// Converts a scheduled entry into a real, live room -- reuses
// roomsRepo.createRoom exactly, so recording and guest join work
// identically to starting an ad-hoc class. Note: the session-start
// admin email notification lives in the POST /api/rooms route handler
// in index.js, not in createRoom itself -- the route that calls this
// function is responsible for firing that notification too, the same
// way POST /api/rooms does.
export async function startScheduledClass(id, actingUser) {
  const raw = await getRaw(id);
  if (!raw) throw new Error('Scheduled class not found');
  if (raw.canceled) throw new Error('This scheduled class was canceled');
  if (raw.room_id) throw new Error('This scheduled class has already started');
  if (actingUser.role !== 'superadmin' && raw.host_user_id !== actingUser.id) {
    throw new Error('Only the host or an admin can start this');
  }
  const endsAt = raw.duration_minutes ? Date.now() + Number(raw.duration_minutes) * 60 * 1000 : null;
  const room = await roomsRepo.createRoom({
    name: raw.title,
    hostUserId: raw.host_user_id,
    endsAt,
    subjectId: raw.subject_id,
    allowGuests: raw.allow_guests,
  });
  await db.query('UPDATE scheduled_classes SET room_id = $1 WHERE id = $2', [room.id, id]);
  return room;
}
