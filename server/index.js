import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import { AccessToken, RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, WebhookReceiver, EgressStatus } from 'livekit-server-sdk';
import { nanoid } from 'nanoid';
import * as db from './db.js';
import * as auth from './auth.js';
import * as subjects from './subjects.js';
import * as roomsRepo from './rooms.js';
import * as recordingsRepo from './recordings.js';
import * as quizzes from './quizzes.js';
import * as assignments from './assignments.js';
import * as billing from './billing.js';
import * as selfRecordings from './selfRecordings.js';
import * as s3 from './s3.js';
import * as emailer from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
  PORT = 4000,
  CLIENT_ORIGIN = 'http://localhost:5173',
  S3_BUCKET,
  S3_REGION,
  S3_ACCESS_KEY,
  S3_SECRET,
  S3_ENDPOINT,
} = process.env;

// CLIENT_ORIGIN can be a single URL or a comma-separated list (e.g. an
// apex domain plus its www subdomain) — the Access-Control-Allow-Origin
// header can only ever contain exactly one origin per response, never a
// literal comma-joined list, so this checks the incoming request's
// origin against the allowed set and echoes back just that one.
const ALLOWED_CLIENT_ORIGINS = CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
// A single canonical origin for building links that get sent elsewhere
// (invite links, password reset emails) — those need one definite URL,
// not a set of allowed ones. Defaults to the first configured origin.
const PRIMARY_CLIENT_ORIGIN = ALLOWED_CLIENT_ORIGINS[0];

function corsOriginCheck(origin, callback) {
  // No origin header at all (e.g. curl, server-to-server, some webhooks)
  // — allow it through; there's nothing to check against.
  if (!origin || ALLOWED_CLIENT_ORIGINS.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin ${origin} is not allowed`));
  }
}

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
  console.warn(
    '[warn] LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL are not set. ' +
    'Copy .env.example to .env and fill them in before joining a live session.'
  );
}

const LIVEKIT_HTTP_URL = LIVEKIT_URL?.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
const roomService =
  LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_HTTP_URL
    ? new RoomServiceClient(LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    : null;
const egressClient =
  LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_HTTP_URL
    ? new EgressClient(LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    : null;
const webhookReceiver =
  LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) : null;
const recordingStorageConfigured = Boolean(S3_BUCKET && S3_REGION && S3_ACCESS_KEY && S3_SECRET);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${nanoid(12)}-${file.originalname}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB — video self-recordings need real headroom, unlike the original slides/notes use case
});

// Self-recordings go straight to R2 instead of local disk (see
// server/s3.js uploadObject) -- memoryStorage buffers the upload in
// RAM just long enough to hand it off, nothing touches Render's
// ephemeral filesystem.
const selfRecordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 },
});

const app = express();
app.use(cors({ origin: corsOriginCheck }));

// LiveKit calls this when an egress (recording) actually finishes
// uploading — this is what lets us know a recording is truly ready to
// download, instead of assuming it's done the moment "stop" was clicked.
// Must be registered before express.json() below: verifying the
// webhook's signature requires the exact raw request body, which
// express.json() would otherwise already have consumed and parsed away.
// Configure this URL (https://<your-backend>/api/livekit/webhook) in
// your LiveKit Cloud project's Settings → Webhooks, or in livekit.yaml
// under `webhook.urls` if self-hosting.
app.post('/api/livekit/webhook', express.raw({ type: 'application/webhook+json' }), async (req, res) => {
  if (!webhookReceiver) return res.status(400).send('LiveKit is not configured');
  try {
    const event = await webhookReceiver.receive(req.body.toString('utf8'), req.get('Authorization'));
    if (event.event === 'egress_ended' && event.egressInfo) {
      const { egressId, status } = event.egressInfo;
      const finalStatus = status === EgressStatus.EGRESS_COMPLETE ? 'completed' : 'failed';
      await recordingsRepo.markRecordingStatus(egressId, finalStatus);
      if (finalStatus === 'failed') {
        console.error(`[livekit] egress ${egressId} ended without completing (status=${status})`);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[livekit] webhook signature/parse error', err);
    res.status(400).send('Invalid webhook');
  }
});

app.use(express.json());

// --- Auth --------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await auth.registerUser(req.body || {});
    res.json({ user, message: 'Account created. An admin must approve it before you can log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { token, user } = await auth.login(req.body || {});
    res.json({ token, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/google-login', async (req, res) => {
  try {
    const { credential } = req.body || {};
    const { token, user } = await auth.loginWithGoogle(credential);
    res.json({ token, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/google-register', async (req, res) => {
  try {
    const { credential } = req.body || {};
    const user = await auth.registerWithGoogle(credential);
    res.json({ user, message: 'Account created. An admin must approve it before you can log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Always responds the same way whether or not the email matches an
// account — see auth.requestPasswordReset for why.
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    const resetBaseUrl = `${PRIMARY_CLIENT_ORIGIN}/reset-password`;
    await auth.requestPasswordReset(email, resetBaseUrl);
  } catch (err) {
    console.error('[auth] forgot-password error', err);
    // Still don't leak anything to the caller — log it and move on.
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    await auth.resetPassword(token, password);
    res.json({ message: 'Password updated — you can log in now.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Public homepage visitor counter -- deliberately unauthenticated (it
// needs to work for people who've never logged in) and deliberately
// coarse: no IP logging, no per-visitor rows, just a single incrementing
// total. The client only calls POST once per browser, gated by a
// localStorage flag on its end.
app.get('/api/visits', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT count FROM site_visits WHERE id = 1');
    res.json({ count: Number(rows[0]?.count || 0) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load visitor count' });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE site_visits SET count = count + 1 WHERE id = 1 RETURNING count'
    );
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not record visit' });
  }
});

// Real, computed count for the homepage stats bar -- rooms actually
// created in the last 30 days, a rolling window rather than a fixed
// calendar month so it doesn't reset to zero on the 1st.
app.get('/api/public/stats', async (req, res) => {
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM rooms WHERE created_at >= $1', [
      thirtyDaysAgo,
    ]);
    res.json({ classesLast30Days: Number(rows[0].n) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

app.patch('/api/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const user = await auth.updateOwnName(req.user.id, req.body?.name);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/change-password', auth.requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await auth.changeOwnPassword(req.user.id, currentPassword, newPassword);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Superadmin: manage accounts ----------------------------------------
app.get('/api/admin/users', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ users: await auth.listUsers() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ user: await auth.adminCreateUser(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id/approve', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ user: await auth.setUserStatus(req.params.id, 'approved') });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id/disable', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ user: await auth.setUserStatus(req.params.id, 'disabled') });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post(
  '/api/admin/users/:id/reset-password',
  auth.requireAuth,
  auth.requireRole('superadmin'),
  async (req, res) => {
    try {
      await auth.adminResetPassword(req.params.id, req.body?.password);
      res.json({ message: 'Password updated' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// --- Live (ephemeral) room state -----------------------------------------
// Everything durable about a room (name, host, time limit, files) lives in
// Postgres via roomsRepo. This map holds only what's genuinely tied to
// open connections right now — the hand-raise queue, who's connected,
// which socket maps to which LiveKit identity. There's nothing to persist
// here; when the process restarts, live sessions have already dropped
// anyway.
const liveRooms = new Map();
function getLiveRoom(roomId) {
  if (!liveRooms.has(roomId)) {
    liveRooms.set(roomId, {
      handQueue: [],
      identityToSocket: new Map(),
      userIdToSocket: new Map(), // account id -> socket.id, enforces one active device per room
      teacherSocketId: null,
      participants: new Map(), // socket.id -> { name, isTeacher, joinedAt, identity, userId }
      activeEgressId: null,
      activeRecordingKey: null,
      timeLimitTimer: null,
      noShowTimer: null,
    });
  }
  return liveRooms.get(roomId);
}

async function requireRoom(roomId, res) {
  const room = await roomsRepo.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  return room;
}

function broadcastRoster(io, live, roomId) {
  const all = [...live.participants.values()];
  const students = all.filter((p) => !p.isTeacher);
  io.to(roomId).emit('roster:count', students.length);
  if (live.teacherSocketId) {
    io.to(live.teacherSocketId).emit(
      'roster:update',
      students.map((s) => ({ name: s.name, joinedAt: s.joinedAt, identity: s.identity || null }))
    );
  }
}

async function endSession(roomId, reason) {
  const room = await roomsRepo.getRoom(roomId);
  if (!room || room.ended) return;
  await roomsRepo.markRoomEnded(roomId);
  io.to(roomId).emit('session:ended', { reason });
  if (roomService) {
    try {
      await roomService.deleteRoom(roomId);
    } catch (err) {
      console.error('[livekit] failed to end room', err);
    }
  }
  const live = liveRooms.get(roomId);
  if (live?.timeLimitTimer) clearTimeout(live.timeLimitTimer);
  if (live?.noShowTimer) clearTimeout(live.noShowTimer);
}

function scheduleTimeLimit(roomId, endsAt) {
  if (!endsAt) return;
  const live = getLiveRoom(roomId);
  if (live.timeLimitTimer) clearTimeout(live.timeLimitTimer);
  const delay = Math.max(0, endsAt - Date.now());
  live.timeLimitTimer = setTimeout(() => endSession(roomId, 'time-limit'), delay);
}

// If nobody at all joins a room within 15 minutes of creating it, it's
// safe to assume the class isn't happening (forgotten invite, wrong
// link, plans changed) — auto-end it so it doesn't sit around forever
// looking "live" to a superadmin checking in on active sessions.
const NO_SHOW_TIMEOUT_MS = 15 * 60_000;
function scheduleNoShowCheck(roomId) {
  const live = getLiveRoom(roomId);
  if (live.noShowTimer) clearTimeout(live.noShowTimer);
  live.noShowTimer = setTimeout(() => {
    const current = liveRooms.get(roomId);
    if (current && current.participants.size === 0) {
      endSession(roomId, 'no-show');
    }
  }, NO_SHOW_TIMEOUT_MS);
}

// Superadmin can see every currently ongoing session (not just their own)
// and get a token to join any of them — no invite link needed. This
// deliberately reuses the same /api/token flow everyone else uses; the
// only thing this endpoint adds is *discovery* of live room IDs, which a
// superadmin otherwise has no way to find without an invite link.
app.get('/api/admin/live-sessions', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.created_at, u.name AS teacher_name
       FROM rooms r JOIN users u ON u.id = r.host_user_id
       WHERE r.ended = false ORDER BY r.created_at DESC`
    );
    const sessions = rows
      // A DB row with ended = false only means nobody has explicitly
      // closed it yet — it says nothing about whether anyone is
      // actually connected right now. A room where the host just closed
      // their browser tab (or a restart wiped the in-memory timers that
      // would've caught this) would otherwise sit here forever looking
      // "live." Only rooms with a real, current participant count as
      // active.
      .map((r) => ({ row: r, live: liveRooms.get(r.id) }))
      .filter(({ live }) => live && live.participants.size > 0)
      .map(({ row: r, live }) => ({
        roomId: r.id,
        name: r.name,
        teacherName: r.teacher_name,
        createdAt: Number(r.created_at),
        teacherConnected: Boolean(live.teacherSocketId),
        studentCount: [...live.participants.values()].filter((p) => !p.isTeacher).length,
      }));
    res.json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list live sessions' });
  }
});

// Create a new classroom. Only an approved staff/superadmin account can
// host. An optional durationMinutes sets a hard time limit: the server
// (not the client's clock) disconnects everyone when it's up.
app.post('/api/rooms', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  const { durationMinutes, subjectId } = req.body || {};

  let resolvedSubjectId = null;
  let resolvedSubjectName = null;
  if (subjectId) {
    try {
      const subject = await subjects.getOwnedSubject(subjectId, req.user);
      resolvedSubjectId = subject.id;
      resolvedSubjectName = subject.name;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  try {
    const minutes = Number(durationMinutes);
    const endsAt = Number.isFinite(minutes) && minutes > 0 ? Date.now() + minutes * 60_000 : null;

    const room = await roomsRepo.createRoom({
      name: `${req.user.name}'s class`,
      hostUserId: req.user.id,
      endsAt,
      subjectId: resolvedSubjectId,
    });
    getLiveRoom(room.id);
    scheduleTimeLimit(room.id, endsAt);
    scheduleNoShowCheck(room.id);

    const inviteLink = `${PRIMARY_CLIENT_ORIGIN}/join/${room.id}`;

    // Best-effort: a notification failure should never stop a teacher
    // from starting class, so this isn't awaited into the response path.
    if (emailer.isEmailConfigured()) {
      auth
        .listUsers()
        .then((users) => {
          const adminEmails = users
            .filter((u) => u.role === 'superadmin' && u.status === 'approved')
            .map((u) => u.email);
          if (adminEmails.length === 0) return;
          return emailer.sendSessionStartEmail(adminEmails, {
            hostName: req.user.name,
            subjectName: resolvedSubjectName,
            joinUrl: inviteLink,
          });
        })
        .catch((err) => console.error('[email] session-start notification failed', err));
    }

    res.json({ roomId: room.id, inviteLink, endsAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create room' });
  }
});

// Issue a LiveKit access token. Requires an approved account. Every
// participant can publish audio/video/screen-share by default; the
// teacher moderates via mute/remove rather than a publish-permission gate.
app.post('/api/token', auth.requireAuth, async (req, res) => {
  try {
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });
    const room = await requireRoom(roomId, res);
    if (!room) return;
    if (room.ended) return res.status(410).json({ error: 'This class has ended' });

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return res.status(500).json({
        error: 'Server is missing LiveKit credentials — set LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL in .env and restart the server.',
      });
    }

    const isTeacher = req.user.id === room.hostUserId;

    // LiveKit enforces one live connection per identity, full stop —
    // that's the protocol's own behavior, not something our server
    // configures. A student staying to one device is intentional (ties
    // into attendance integrity), but staff/superadmin legitimately
    // need to be signed in from a laptop and a phone simultaneously —
    // giving them a fresh identity suffix per session is what actually
    // lets LiveKit treat those as distinct participants instead of one
    // replacing the other. Each new token request (i.e. each fresh page
    // load) gets its own suffix; a single tab's own reconnects reuse the
    // same token/identity throughout its session, so this doesn't cause
    // duplicate-participant flicker on normal network hiccups.
    const identity =
      req.user.role === 'staff' || req.user.role === 'superadmin'
        ? `user-${req.user.id}-${nanoid(6)}`
        : `user-${req.user.id}`;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: req.user.name,
    });
    at.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    res.json({ token, livekitUrl: LIVEKIT_URL, isTeacher, roomName: room.name, endsAt: room.endsAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not issue token' });
  }
});

app.get('/api/rooms/:roomId', auth.requireAuth, async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    res.json({ name: room.name, endsAt: room.endsAt, ended: room.ended });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load room' });
  }
});

// --- File sharing ------------------------------------------------------
// File bytes stay on local disk for this MVP — move to S3/GCS before
// production, same as recordings. Metadata (who uploaded what, when) is
// in Postgres so the list survives a server restart even though the
// actual files are still local-disk-only for now.
app.post(
  '/api/rooms/:roomId/files',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  upload.single('file'),
  async (req, res) => {
    try {
      const room = await requireRoom(req.params.roomId, res);
      if (!room) return;
      if (room.hostUserId !== req.user.id) {
        return res.status(403).json({ error: "Only this class's host can share files here" });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const entry = await roomsRepo.addRoomFile(req.params.roomId, {
        filename: req.file.filename,
        originalName: req.file.originalname,
        sizeBytes: req.file.size,
        uploadedBy: req.user.name,
      });
      res.json({ file: entry });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save file' });
    }
  }
);

app.get('/api/rooms/:roomId/files', auth.requireAuth, async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    res.json({ files: await roomsRepo.listRoomFiles(req.params.roomId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list files' });
  }
});

app.get('/api/rooms/:roomId/files/:fileId', auth.requireAuth, async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    const entry = await roomsRepo.getRoomFile(req.params.roomId, req.params.fileId);
    if (!entry) return res.status(404).json({ error: 'File not found' });
    res.download(path.join(UPLOAD_DIR, entry.filename), entry.originalName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not download file' });
  }
});

// --- Subjects, enrollment, syllabus ---------------------------------------
app.post('/api/subjects', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const subject = await subjects.createSubject({
      name: req.body?.name,
      staffId: req.user.id,
      staffName: req.user.name,
    });
    res.json({ subject });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/subjects', auth.requireAuth, async (req, res) => {
  try {
    res.json({ subjects: await subjects.listSubjectsFor(req.user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list subjects' });
  }
});

// Deletes a subject entirely — enrollments, quizzes, assignments, and
// their submissions all go with it. No undo, so the client should
// confirm with the person before calling this.
app.delete('/api/subjects/:subjectId', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const result = await subjects.deleteSubject(req.params.subjectId, req.user);
    res.json({ subject: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(
  '/api/subjects/:subjectId/teachers',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const subject = await subjects.addCoTeacher(req.params.subjectId, req.body?.staffId, req.user);
      res.json({ subject });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.delete(
  '/api/subjects/:subjectId/teachers/:staffId',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const subject = await subjects.removeCoTeacher(req.params.subjectId, req.params.staffId, req.user);
      res.json({ subject });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.get('/api/students', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const students = (await auth.listUsers()).filter((u) => u.role === 'student' && u.status === 'approved');
    res.json({ students: students.map((s) => ({ id: s.id, name: s.name, email: s.email })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list students' });
  }
});

// Any approved account can see the staff list — students need it to pick
// who to share a self-recording with.
// Public educator directory for the homepage's "Find Educators" page --
// deliberately separate from GET /api/staff (which is auth-only and
// includes email for the self-recording share dropdown). This only
// ever exposes a name and the subjects that staff member has created,
// and only for staff whose account is still approved. An educator with
// zero subjects created yet doesn't show up -- nothing to find.
app.get('/api/public/educators', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.staff_id, s.staff_name, array_agg(DISTINCT s.name ORDER BY s.name) AS subjects
      FROM subjects s
      JOIN users u ON u.id = s.staff_id
      WHERE u.status = 'approved'
      GROUP BY s.staff_id, s.staff_name
      ORDER BY s.staff_name
    `);
    res.json({
      educators: rows.map((r) => ({ id: r.staff_id, name: r.staff_name, subjects: r.subjects })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load educators' });
  }
});

app.get('/api/staff', auth.requireAuth, async (req, res) => {
  try {
    // Staff and superadmin are both valid people for a student to share
    // a self-recording with — a superadmin might genuinely be the one
    // reviewing it (e.g. a small school where the admin also teaches),
    // so this isn't staff-only.
    const staff = (await auth.listUsers()).filter(
      (u) => (u.role === 'staff' || u.role === 'superadmin') && u.status === 'approved'
    );
    res.json({ staff: staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list staff' });
  }
});

// --- Student self-recordings ------------------------------------------
// A student's own recording of themselves (mic/camera, toggled on
// manually by the student) — distinct from the room-level session
// recording. Stored on R2, same as session recordings.
app.post(
  '/api/self-recordings',
  auth.requireAuth,
  auth.requireRole('student'),
  selfRecordingUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No recording received' });
      if (!recordingStorageConfigured) {
        return res.status(500).json({ error: 'Recording storage is not configured' });
      }
      const key = `self-recordings/${nanoid(12)}-${req.file.originalname}`;
      await s3.uploadObject(key, req.file.buffer, req.file.mimetype);
      const recording = await selfRecordings.createRecording({
        studentId: req.user.id,
        filename: key,
        originalName: req.file.originalname,
      });
      res.json({ recording });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save recording' });
    }
  }
);

app.get('/api/self-recordings', auth.requireAuth, auth.requireRole('student'), async (req, res) => {
  try {
    res.json({ recordings: await selfRecordings.listForStudent(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list recordings' });
  }
});

app.post('/api/self-recordings/:id/share', auth.requireAuth, auth.requireRole('student'), async (req, res) => {
  try {
    await selfRecordings.shareRecording(req.params.id, req.user.id, req.body?.staffId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Unshare -- not a hard delete. The owning student, the staff member
// it's currently shared with, or a superadmin can sever the share;
// permission specifics are enforced in selfRecordings.unshareRecording.
app.delete('/api/self-recordings/:id/share', auth.requireAuth, async (req, res) => {
  try {
    await selfRecordings.unshareRecording(req.params.id, req.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get(
  '/api/self-recordings/shared-with-me',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const recordings =
        req.user.role === 'superadmin'
          ? await selfRecordings.listAllShared()
          : await selfRecordings.listSharedWithStaff(req.user.id);
      res.json({ recordings });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not list shared recordings' });
    }
  }
);

app.get('/api/self-recordings/:id/download', auth.requireAuth, async (req, res) => {
  try {
    const file = await selfRecordings.getRecordingForDownload(req.params.id, req.user);
    if (!(await s3.objectExists(file.r2Key))) {
      return res.status(404).json({
        error:
          'This recording is no longer available (it was made before storage was upgraded). Please re-record and share again.',
      });
    }
    const url = await s3.getDownloadUrl(file.r2Key, file.originalName);
    res.json({ url });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.post('/api/subjects/:subjectId/enroll', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    await subjects.getOwnedSubject(req.params.subjectId, req.user);
    res.json({ subject: await subjects.enrollStudent(req.params.subjectId, req.body?.studentId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/subjects/:subjectId/enroll/:studentId', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    await subjects.getOwnedSubject(req.params.subjectId, req.user);
    res.json({ subject: await subjects.unenrollStudent(req.params.subjectId, req.params.studentId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(
  '/api/subjects/:subjectId/syllabus',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  upload.single('file'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const subject = await subjects.setSyllabus(req.params.subjectId, {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        uploadedAt: Date.now(),
      });
      res.json({ subject });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Alternative to uploading a file — type the syllabus directly. Setting
// this clears any previously uploaded file, and vice versa: there's one
// syllabus, not both at once.
app.put(
  '/api/subjects/:subjectId/syllabus-text',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      const subject = await subjects.setSyllabusText(req.params.subjectId, req.body?.text || '');
      res.json({ subject });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Serves the syllabus for viewing only — as plain text if it was typed
// manually, or as an inline-rendered file otherwise. This is a soft
// deterrent, not real protection — nothing stops a screenshot of whatever
// ends up on screen either way.
app.get('/api/subjects/:subjectId/syllabus', auth.requireAuth, async (req, res) => {
  try {
    const syllabus = await subjects.getSyllabusForViewing(req.params.subjectId, req.user);
    if (syllabus.type === 'text') {
      return res.json({ type: 'text', text: syllabus.text });
    }
    res.setHeader('Content-Disposition', `inline; filename="${syllabus.originalName}"`);
    res.setHeader('Content-Type', syllabus.mimeType || 'application/octet-stream');
    res.sendFile(path.join(UPLOAD_DIR, syllabus.filename));
  } catch (err) {
    const status = err.message === 'Subject not found' ? 404 : 403;
    res.status(status).json({ error: err.message });
  }
});

// --- Quizzes ---------------------------------------------------------------
// Generated from a subject's syllabus and/or a topic via the Anthropic API.
// Published immediately with no teacher review step — an explicit choice,
// not an oversight; question quality depends entirely on what the model
// produces.
app.post(
  '/api/subjects/:subjectId/quizzes',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      const quiz = await quizzes.generateQuiz({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        topic: req.body?.topic,
        uploadDir: UPLOAD_DIR,
        questionCount: req.body?.questionCount,
      });
      res.json({ quiz });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.get('/api/subjects/:subjectId/quizzes', auth.requireAuth, async (req, res) => {
  try {
    // Anyone who can see the subject (owning staff, superadmin, or an
    // enrolled student — same rule as syllabus visibility) can see the
    // quiz list; getOwnedSubject/listSubjectsFor already gate that
    // upstream via the subject list, so no extra check needed here beyond
    // being authenticated.
    res.json({ quizzes: await quizzes.listQuizzesForSubject(req.params.subjectId, req.user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list quizzes' });
  }
});

// Every class session ever started for this subject — lets a teacher
// find their way back to a past class to check attendance/recordings,
// since there's otherwise no way to rediscover a room's URL once its
// live session has ended. Teacher-only (like the roster), not visible
// to students.
app.get('/api/subjects/:subjectId/rooms', auth.requireAuth, async (req, res) => {
  try {
    await subjects.getOwnedSubject(req.params.subjectId, req.user);
    res.json({ rooms: await roomsRepo.listRoomsForSubject(req.params.subjectId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Write a quiz by hand instead of generating it — no AI involved.
app.post(
  '/api/subjects/:subjectId/quizzes/manual',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      const quiz = await quizzes.createManualQuiz({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        topic: req.body?.topic,
        questions: req.body?.questions || [],
      });
      res.json({ quiz });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Upload an already-written quiz document — parsed into structured
// questions rather than inventing new ones.
app.post(
  '/api/subjects/:subjectId/quizzes/upload',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  upload.single('file'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const quiz = await quizzes.generateQuizFromUpload({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        uploadDir: UPLOAD_DIR,
        file: req.file,
      });
      res.json({ quiz });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Edit an existing quiz's questions — works whether it was generated or
// written by hand.
app.put('/api/quizzes/:quizId', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const result = await quizzes.updateQuiz(req.params.quizId, req.user, req.body?.questions || []);
    res.json({ quiz: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Approve a draft quiz (generated or uploaded) so students can see it.
app.post(
  '/api/quizzes/:quizId/publish',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const result = await quizzes.publishQuiz(req.params.quizId, req.user);
      res.json({ quiz: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Pull a published quiz back to draft.
app.post(
  '/api/quizzes/:quizId/unpublish',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const result = await quizzes.unpublishQuiz(req.params.quizId, req.user);
      res.json({ quiz: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Deletes the quiz and any student submissions for it.
app.delete('/api/quizzes/:quizId', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const result = await quizzes.deleteQuiz(req.params.quizId, req.user);
    res.json({ quiz: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Student view — strips answers unless already submitted.
app.get('/api/quizzes/:quizId', auth.requireAuth, async (req, res) => {
  try {
    const quiz = await quizzes.getQuizForStudent(req.params.quizId, req.user.id);
    res.json({ quiz });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Teacher view — always includes correct answers/rubrics.
app.get('/api/quizzes/:quizId/full', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const quiz = await quizzes.getQuizForOwner(req.params.quizId, req.user);
    res.json({ quiz });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.post('/api/quizzes/:quizId/submit', auth.requireAuth, auth.requireRole('student'), async (req, res) => {
  try {
    const result = await quizzes.submitQuiz(req.params.quizId, req.user.id, req.body?.answers || {});
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get(
  '/api/quizzes/:quizId/submissions',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await quizzes.getQuizForOwner(req.params.quizId, req.user); // ownership check
      res.json({ submissions: await quizzes.listSubmissionsForQuiz(req.params.quizId) });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }
);

// --- Assignments -------------------------------------------------------
// The longer-form complement to quizzes: essay/problem-set style tasks,
// generated the same way (syllabus + topic), also published immediately
// with no review step. Students submit text and/or a file; grading uses
// the same AI-against-rubric approach as quiz free-text questions.
app.post(
  '/api/subjects/:subjectId/assignments',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      const assignment = await assignments.generateAssignment({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        topic: req.body?.topic,
        uploadDir: UPLOAD_DIR,
        dueAt: req.body?.dueAt ? Number(req.body.dueAt) : null,
      });
      res.json({ assignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.get('/api/subjects/:subjectId/assignments', auth.requireAuth, async (req, res) => {
  try {
    res.json({ assignments: await assignments.listAssignmentsForSubject(req.params.subjectId, req.user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list assignments' });
  }
});

// Write an assignment by hand instead of generating it.
app.post(
  '/api/subjects/:subjectId/assignments/manual',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      const assignment = await assignments.createManualAssignment({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        title: req.body?.title,
        instructions: req.body?.instructions,
        rubric: req.body?.rubric,
        dueAt: req.body?.dueAt ? Number(req.body.dueAt) : null,
      });
      res.json({ assignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Upload a document that becomes the assignment itself.
app.post(
  '/api/subjects/:subjectId/assignments/upload',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  upload.single('file'),
  async (req, res) => {
    try {
      await subjects.getOwnedSubject(req.params.subjectId, req.user);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const assignment = await assignments.createAssignmentFromUpload({
        subjectId: req.params.subjectId,
        staffId: req.user.id,
        uploadDir: UPLOAD_DIR,
        file: req.file,
        title: req.body?.title,
        dueAt: req.body?.dueAt ? Number(req.body.dueAt) : null,
      });
      res.json({ assignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Edit an existing assignment — works whether it was generated, written
// by hand, or created from an upload.
app.put('/api/assignments/:assignmentId', auth.requireAuth, auth.requireRole('staff', 'superadmin'), async (req, res) => {
  try {
    const result = await assignments.updateAssignment(req.params.assignmentId, req.user, {
      title: req.body?.title,
      instructions: req.body?.instructions,
      rubric: req.body?.rubric,
      dueAt: req.body?.dueAt ? Number(req.body.dueAt) : null,
    });
    res.json({ assignment: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Approve a draft assignment (generated or uploaded) so students can see it.
app.post(
  '/api/assignments/:assignmentId/publish',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const result = await assignments.publishAssignment(req.params.assignmentId, req.user);
      res.json({ assignment: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Pull a published assignment back to draft.
app.post(
  '/api/assignments/:assignmentId/unpublish',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const result = await assignments.unpublishAssignment(req.params.assignmentId, req.user);
      res.json({ assignment: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Deletes the assignment and any student submissions for it.
app.delete(
  '/api/assignments/:assignmentId',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const result = await assignments.deleteAssignment(req.params.assignmentId, req.user);
      res.json({ assignment: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Downloads the original file for an upload-based assignment.
app.get('/api/assignments/:assignmentId/source-file', auth.requireAuth, async (req, res) => {
  try {
    const file = await assignments.getAssignmentSourceFile(req.params.assignmentId);
    res.download(path.join(UPLOAD_DIR, file.filename), file.originalName);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Student view — never includes the rubric.
app.get('/api/assignments/:assignmentId', auth.requireAuth, async (req, res) => {
  try {
    const assignment = await assignments.getAssignmentForStudent(req.params.assignmentId, req.user.id);
    res.json({ assignment });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Teacher view — includes the rubric.
app.get(
  '/api/assignments/:assignmentId/full',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const assignment = await assignments.getAssignmentForOwner(req.params.assignmentId, req.user);
      res.json({ assignment });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }
);

app.post(
  '/api/assignments/:assignmentId/submit',
  auth.requireAuth,
  auth.requireRole('student'),
  upload.single('file'),
  async (req, res) => {
    try {
      const result = await assignments.submitAssignment(req.params.assignmentId, req.user.id, {
        textAnswer: req.body?.textAnswer,
        file: req.file,
        uploadDir: UPLOAD_DIR,
      });
      res.json({ result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.get(
  '/api/assignments/:assignmentId/submissions',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      await assignments.getAssignmentForOwner(req.params.assignmentId, req.user); // ownership check
      res.json({ submissions: await assignments.listSubmissionsForAssignment(req.params.assignmentId) });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }
);

// --- Billing -----------------------------------------------------------
// Deliberately simple: an admin-editable instructions block (bank
// details, payment methods, whatever they want to write) plus a manual
// paid/unpaid ledger. Not a payment processor — no actual money moves
// through this, it's a record-keeping tool for payments that happened
// elsewhere (bank transfer, mobile money, cash, etc.).
app.get('/api/billing/instructions', auth.requireAuth, async (req, res) => {
  try {
    res.json({ instructions: await billing.getInstructions() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load billing instructions' });
  }
});

app.put('/api/billing/instructions', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const instructions = await billing.setInstructions(req.body?.instructions || '', req.user.id);
    res.json({ instructions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save billing instructions' });
  }
});

app.get('/api/billing/students', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ students: await billing.listStudentsWithStatus() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list student payment status' });
  }
});

// A student can see their own payment history; a superadmin can see
// anyone's.
app.get('/api/billing/students/:studentId/payments', auth.requireAuth, async (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.id !== req.params.studentId) {
    return res.status(403).json({ error: 'Not permitted' });
  }
  try {
    res.json({ payments: await billing.listPaymentsForStudent(req.params.studentId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list payments' });
  }
});

app.post(
  '/api/billing/students/:studentId/payments',
  auth.requireAuth,
  auth.requireRole('superadmin'),
  async (req, res) => {
    try {
      const payment = await billing.addPayment({
        studentId: req.params.studentId,
        amount: req.body?.amount,
        note: req.body?.note,
        recordedBy: req.user.id,
      });
      res.json({ payment });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not record payment' });
    }
  }
);

app.delete('/api/billing/payments/:paymentId', auth.requireAuth, auth.requireRole('superadmin'), async (req, res) => {
  try {
    await billing.deletePayment(req.params.paymentId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete payment' });
  }
});

// --- Recording -----------------------------------------------------------
// Uses LiveKit Egress to record the room composite to S3-compatible
// storage. Requires S3_BUCKET/S3_REGION/S3_ACCESS_KEY/S3_SECRET in .env.
app.post(
  '/api/rooms/:roomId/recording/start',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const room = await requireRoom(req.params.roomId, res);
      if (!room) return;
      if (room.hostUserId !== req.user.id) {
        return res.status(403).json({ error: "Only this class's host can record it" });
      }
      if (!egressClient || !recordingStorageConfigured) {
        return res.status(400).json({
          error: "Recording storage isn't configured — set S3_BUCKET/S3_REGION/S3_ACCESS_KEY/S3_SECRET in .env",
        });
      }
      const live = getLiveRoom(req.params.roomId);
      if (live.activeEgressId) {
        return res.status(400).json({ error: 'Already recording' });
      }
      const filepath = `recordings/${req.params.roomId}-${Date.now()}.mp4`;
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 's3',
          value: new S3Upload({
            bucket: S3_BUCKET,
            region: S3_REGION,
            accessKey: S3_ACCESS_KEY,
            secret: S3_SECRET,
            endpoint: S3_ENDPOINT || undefined,
          }),
        },
      });
      const info = await egressClient.startRoomCompositeEgress(
        req.params.roomId,
        { file: fileOutput },
        { layout: 'speaker' }
      );
      live.activeEgressId = info.egressId;
      live.activeRecordingKey = filepath;
      await recordingsRepo.startRecording(req.params.roomId, info.egressId, filepath);
      io.to(req.params.roomId).emit('recording:status', { recording: true });
      res.json({ egressId: info.egressId });
    } catch (err) {
      console.error('[livekit] failed to start recording', err);
      res.status(500).json({ error: 'Could not start recording' });
    }
  }
);

app.post(
  '/api/rooms/:roomId/recording/stop',
  auth.requireAuth,
  auth.requireRole('staff', 'superadmin'),
  async (req, res) => {
    try {
      const room = await requireRoom(req.params.roomId, res);
      if (!room) return;
      if (room.hostUserId !== req.user.id) {
        return res.status(403).json({ error: "Only this class's host can stop its recording" });
      }
      const live = getLiveRoom(req.params.roomId);
      if (!egressClient || !live.activeEgressId) {
        return res.status(400).json({ error: 'Not currently recording' });
      }
      await egressClient.stopEgress(live.activeEgressId);
      // The egress service finishes uploading to R2 asynchronously after
      // this call returns. Marking it "processing" here (rather than
      // "completed") keeps it correctly hidden from downloads until the
      // /api/livekit/webhook handler above hears egress_ended and flips
      // it to "completed" — otherwise a download attempted too soon
      // fails with NoSuchKey because the file isn't in R2 yet.
      await recordingsRepo.markRecordingStatus(live.activeEgressId, 'processing');
      live.activeEgressId = null;
      live.activeRecordingKey = null;
      io.to(req.params.roomId).emit('recording:status', { recording: false });
      res.json({ ok: true });
    } catch (err) {
      console.error('[livekit] failed to stop recording', err);
      res.status(500).json({ error: 'Could not stop recording' });
    }
  }
);

// List and download completed recordings. Same access pattern as file
// sharing: any approved account can view/download, only the host can
// start/stop a recording in the first place.
app.get('/api/rooms/:roomId/recordings', auth.requireAuth, async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    res.json({ recordings: await recordingsRepo.listRecordings(req.params.roomId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list recordings' });
  }
});

// Present/absent breakdown for a room linked to a subject — only that
// subject's teacher or a superadmin can see it, same access level as
// the roster itself.
app.get('/api/rooms/:roomId/attendance', auth.requireAuth, async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    if (req.user.role !== 'superadmin' && room.hostUserId !== req.user.id) {
      return res.status(403).json({ error: 'Only this class\'s teacher can view attendance' });
    }
    res.json(await roomsRepo.getAttendance(req.params.roomId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load attendance' });
  }
});

// Returns a short-lived presigned URL the browser can download directly
// from R2 — the file goes straight to the user's device, never proxied
// through this server.
app.get(
  '/api/rooms/:roomId/recordings/:recordingId/download-url',
  auth.requireAuth,
  async (req, res) => {
  try {
    const room = await requireRoom(req.params.roomId, res);
    if (!room) return;
    const recording = await recordingsRepo.getRecording(req.params.roomId, req.params.recordingId);
    if (!recording) return res.status(404).json({ error: 'Recording not found' });
    if (recording.status !== 'completed') {
      return res.status(409).json({ error: "This recording is still processing — try again in a minute." });
    }
    const filename = `${room.name.replace(/[^a-z0-9]+/gi, '-')}-${recording.startedAt}.mp4`;
    const url = await s3.getDownloadUrl(recording.s3Key, filename);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not generate download link' });
  }
});

// Safety net: an error thrown inside an async route/socket handler becomes
// an unhandled promise rejection, and Node.js kills the whole process on
// those by default — which would disconnect every user, not just the one
// making the failing request. Log it instead of crashing.
process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: ALLOWED_CLIENT_ORIGINS },
});

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentName = null;
  let isTeacher = false;
  let identity = null;
  let userId = null;

  socket.on('join-room', async ({ roomId, token }) => {
    try {
      const room = await roomsRepo.getRoom(roomId);
      if (!room) {
        socket.emit('error-message', 'Room not found');
        return;
      }
      const user = await auth.verifySocketToken(token);

      currentRoomId = roomId;
      currentName = user.name;
      isTeacher = user.id === room.hostUserId;
      userId = user.id;

      const live = getLiveRoom(roomId);

      // Single-device enforcement: if this account already has an active
      // connection in this room (a different device/tab), disconnect it
      // in favor of this new one. This mirrors what LiveKit's media layer
      // already does automatically for students — its identity is
      // `user-${user.id}`, the same across devices for one account, so
      // LiveKit itself drops the older media connection when a new one
      // connects with that identity. Staff/superadmin get a per-session
      // identity suffix instead (see /api/token above) specifically so
      // they CAN be on multiple devices at once — so this kick logic is
      // skipped for them too, to keep this signaling layer consistent
      // with what LiveKit itself is actually doing.
      const isPrivilegedRole = user.role === 'staff' || user.role === 'superadmin';
      const existingSocketId = live.userIdToSocket.get(user.id);
      if (!isPrivilegedRole && existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          existingSocket.emit('device:superseded');
          existingSocket.disconnect(true);
        }
        live.participants.delete(existingSocketId);
      }
      live.userIdToSocket.set(user.id, socket.id);
      if (live.noShowTimer) {
        clearTimeout(live.noShowTimer);
        live.noShowTimer = null;
      }

      socket.join(roomId);
      live.participants.set(socket.id, { name: user.name, isTeacher, joinedAt: Date.now(), identity: null });
      if (!isTeacher && room.subjectId) {
        roomsRepo.recordAttendance(roomId, user.id).catch((err) => {
          console.error('[attendance] failed to record', err);
        });
      }

      if (isTeacher) {
        live.teacherSocketId = socket.id;
        socket.emit('hand:queue-update', live.handQueue);
      }
      broadcastRoster(io, live, roomId);
    } catch {
      socket.emit('error-message', 'Not authenticated');
    }
  });

  socket.on('register-identity', ({ identity: id }) => {
    if (!currentRoomId || !id) return;
    identity = id;
    const live = getLiveRoom(currentRoomId);
    live.identityToSocket.set(id, socket.id);
    const participant = live.participants.get(socket.id);
    if (participant) {
      participant.identity = id;
      broadcastRoster(io, live, currentRoomId);
    }
  });

  socket.on('chat:send', ({ text }) => {
    if (!currentRoomId || !text?.trim()) return;
    io.to(currentRoomId).emit('chat:message', {
      id: nanoid(8),
      name: currentName,
      text: text.trim().slice(0, 1000),
      isTeacher,
      ts: Date.now(),
    });
  });

  socket.on('hand:raise', ({ question }) => {
    if (!currentRoomId || isTeacher) return;
    const live = getLiveRoom(currentRoomId);
    const entry = {
      id: nanoid(8),
      name: currentName,
      identity,
      question: (question || '').trim().slice(0, 300),
      ts: Date.now(),
    };
    live.handQueue.push(entry);
    if (live.teacherSocketId) {
      io.to(live.teacherSocketId).emit('hand:queue-update', live.handQueue);
    }
    socket.emit('hand:submitted');
  });

  socket.on('hand:resolve', ({ requestId }) => {
    if (!currentRoomId || !isTeacher) return;
    const live = getLiveRoom(currentRoomId);
    live.handQueue = live.handQueue.filter((r) => r.id !== requestId);
    socket.emit('hand:queue-update', live.handQueue);
  });

  socket.on('mod:mute', async ({ identity: targetIdentity }) => {
    if (!currentRoomId || !isTeacher || !roomService || !targetIdentity) return;
    try {
      const participants = await roomService.listParticipants(currentRoomId);
      const target = participants.find((p) => p.identity === targetIdentity);
      const audioTrack = target?.tracks?.find((t) => String(t.type) === 'AUDIO' || t.type === 0);
      if (audioTrack) {
        await roomService.mutePublishedTrack(currentRoomId, targetIdentity, audioTrack.sid, true);
      }
    } catch (err) {
      console.error('[livekit] failed to mute participant', err);
    }
  });

  socket.on('mod:mute-all', async () => {
    if (!currentRoomId || !isTeacher || !roomService) return;
    try {
      const participants = await roomService.listParticipants(currentRoomId);
      await Promise.all(
        participants
          .filter((p) => p.identity !== identity)
          .flatMap((p) => (p.tracks || []).filter((t) => String(t.type) === 'AUDIO' || t.type === 0)
            .map((t) => roomService.mutePublishedTrack(currentRoomId, p.identity, t.sid, true).catch(() => {})))
      );
    } catch (err) {
      console.error('[livekit] failed to mute all', err);
    }
  });

  socket.on('mod:remove', async ({ identity: targetIdentity }) => {
    if (!currentRoomId || !isTeacher || !targetIdentity) return;
    if (roomService) {
      try {
        await roomService.removeParticipant(currentRoomId, targetIdentity);
      } catch (err) {
        console.error('[livekit] failed to remove participant', err);
      }
    }
    const live = getLiveRoom(currentRoomId);
    const targetSocketId = live.identityToSocket.get(targetIdentity);
    if (targetSocketId) io.to(targetSocketId).emit('removed');
  });

  // Teacher explicitly ending the class — as opposed to just leaving,
  // which only disconnects them and leaves the room open for everyone
  // else. This disconnects all participants and closes the room.
  socket.on('session:end', async () => {
    if (!currentRoomId || !isTeacher) return;
    await endSession(currentRoomId, 'ended-by-teacher');
  });

  // Whiteboard: only the teacher can draw, everyone sees it live.
  socket.on('whiteboard:draw', (stroke) => {
    if (!currentRoomId || !isTeacher) return;
    socket.to(currentRoomId).emit('whiteboard:draw', stroke);
  });

  socket.on('whiteboard:clear', () => {
    if (!currentRoomId || !isTeacher) return;
    io.to(currentRoomId).emit('whiteboard:clear');
  });

  // Captions: each speaker's own browser transcribes their own mic locally
  // (Web Speech API) and broadcasts the text — the server just relays it.
  socket.on('caption:text', ({ text, final }) => {
    if (!currentRoomId || !text) return;
    socket.to(currentRoomId).emit('caption:text', { name: currentName, text, final: Boolean(final) });
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const live = liveRooms.get(currentRoomId);
    if (!live) return;
    if (identity && live.identityToSocket.get(identity) === socket.id) {
      live.identityToSocket.delete(identity);
    }
    if (userId && live.userIdToSocket.get(userId) === socket.id) {
      live.userIdToSocket.delete(userId);
    }
    if (live.teacherSocketId === socket.id) {
      live.teacherSocketId = null;
    }
    if (live.participants.has(socket.id)) {
      live.participants.delete(socket.id);
      broadcastRoster(io, live, currentRoomId);
    }
  });
});

async function start() {
  await db.initSchema();
  await auth.ensureBootstrapSuperadmin();

  // Reschedule time-limit cutoffs for rooms that were still active before
  // this restart — otherwise a server restart would silently cancel every
  // pending cutoff.
  if (db.isConfigured()) {
    const active = await roomsRepo.listActiveTimedRooms();
    for (const room of active) scheduleTimeLimit(room.id, room.endsAt);
  }

  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start();
