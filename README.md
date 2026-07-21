# Classroom Live — MVP

An education-first live teaching platform. One teacher publishes audio, camera,
and screen-share; up to ~30 students watch, listen, chat freely, and raise a
hand (with an optional question) to get the teacher's attention. Only the
teacher can ever publish media or draw on the whiteboard — that single rule
is enforced server-side, not just hidden in the UI.

## Stack

- **Media**: [LiveKit](https://livekit.io) (WebRTC SFU) — handles the actual
  audio/video/screen-share transport and scales far better than peer-to-peer
  once you're past a handful of participants.
- **Realtime app state** (chat, hand-raise queue, whiteboard strokes,
  captions): Socket.io — deliberately separate from the media layer, since
  this is ordinary application state, not media. This stays in-memory even
  with the database connected, since it's tied to actual open connections —
  when the server restarts, those connections have already dropped anyway.
- **Database**: [Supabase](https://supabase.com) Postgres (`server/db.js`,
  connected with the plain `pg` driver, not Supabase's JS client — Supabase
  is just hosted Postgres, so this behaves like any other Postgres
  database). Persists users, rooms, subjects, enrollments, and file
  metadata. Schema is created automatically on first run
  (`db.initSchema()`) — no separate migration step needed.
- **File bytes**: still local disk (`server/uploads/`) — only *metadata*
  (who uploaded what, when) is in Postgres so the file list survives a
  restart. Move actual file storage to S3/GCS before production, same
  caveat as recordings.
- **Accounts & auth**: JWT-based, backed by the `users` table. Passwords
  are hashed with bcrypt.
- **Backend**: Node.js + Express.
- **Frontend**: React + Vite, packaged as a PWA (installable, offline app
  shell) so it works well on phones and slower connections without needing
  native apps.

## Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   fine).
2. In the dashboard: **Settings → Database → Connection string** — copy the
   "Session pooler" connection string and swap in your actual database
   password (set when you created the project).
3. Paste it into `server/.env` as `SUPABASE_DB_URL`.
4. Start the server — on first run it logs `[db] Connected to Supabase and
   verified schema.` and creates the `users`, `rooms`, `room_files`,
   `subjects`, and `subject_enrollments` tables automatically. Nothing to
   run by hand.

Without `SUPABASE_DB_URL` set, the server still starts, but every
database-backed action (register, login, create a room, create a subject)
will fail with a clear "Database not configured" error rather than
silently falling back to memory — this is a deliberate change from
earlier versions of this app, which *did* fall back to in-memory storage.
That fallback made it easy to not notice data wasn't persisting; failing
loudly instead means you'll know immediately if the connection string is
wrong.

## Accounts, roles, and approval

- Three roles: **student**, **staff**, **superadmin**.
- Self-registration (`/register`) always lands as **pending** — regardless
  of role — and can't log in until a superadmin approves it.
- A superadmin can also create accounts directly (`/admin`); those are
  **auto-approved**, since the superadmin creating it *is* the approval.
- A superadmin can disable any account at any time; a disabled account
  can't log in even if it was previously approved.
- Joining a class (or hosting one) requires an approved account — there's
  no more anonymous "type your name" join flow.
- **Bootstrapping**: since there's no way to log in before any accounts
  exist, the server creates one superadmin automatically from
  `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` in `.env` on first start. Use
  that account to log in and create everyone else from `/admin`.

## Why this shape

- **Open publish, moderated rather than gated.** Every approved account gets
  `canPublish: true` at token time — anyone can turn on their mic, camera,
  or screen-share whenever they want. Control now happens through
  moderation (`server/index.js`'s `mod:*` socket events, backed by
  LiveKit's `RoomServiceClient`): the teacher can mute one student, mute
  everyone, or remove someone outright. This replaced an earlier
  single-publisher-only design once the requirement changed to "every user
  can turn on camera/mic when he/she wants."
- **Hand-raise stayed as a pure attention queue.** With publish open by
  default there's nothing left to "grant" — raising a hand is now just a
  way to ask the teacher a question in an orderly queue, not a permission
  request.
- **Time limits are enforced server-side, not client-side.** The
  `setTimeout` that ends a session lives on the server and calls LiveKit's
  `deleteRoom` directly — a student closing their laptop or a teacher's
  browser tab crashing doesn't affect whether the cutoff happens.

## Getting it running

You'll need Node.js 18+ and a LiveKit project (the free "Build" tier at
[cloud.livekit.io](https://cloud.livekit.io) works fine for development).

```bash
# 1. Backend
cd server
cp .env.example .env       # fill in LIVEKIT_API_KEY / SECRET / URL,
                            # JWT_SECRET, and SUPERADMIN_EMAIL/PASSWORD
npm install
npm run dev                # http://localhost:4000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev                # http://localhost:5173
```

Open http://localhost:5173, log in with the `SUPERADMIN_EMAIL` /
`SUPERADMIN_PASSWORD` you set — that's your way in. From `/admin`, create a
staff account and a student account (both auto-approved). Log in as the
staff account in one browser to start a class; log in as the student
account in another (or an incognito window) and open the invite link to
join.

## What's done so far

1. ✅ Accounts, roles, and the approval workflow.
2. ✅ **Open camera/mic for everyone**, with moderation: teacher can mute one
   student, mute everyone at once, or remove a participant entirely
   (`server/index.js`'s `mod:mute` / `mod:mute-all` / `mod:remove` socket
   events, backed by LiveKit's `RoomServiceClient`).
3. ✅ **File sharing** — teacher uploads (staff/superadmin only, scoped to
   their own room), everyone can view the list and download. Stored on
   local disk for now (`server/uploads/`) — move to S3/GCS before
   production, same caveat as the in-memory room store.
4. ✅ **Recording** — teacher can start/stop recording via LiveKit Egress.
   Requires `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET` in `.env`;
   without them the button will show a clear error instead of silently
   doing nothing.
5. ✅ **Session time limits** — host can set a duration in minutes when
   starting a class. The server (not the client's clock) enforces the
   cutoff with `setTimeout` + LiveKit's `deleteRoom`, disconnecting
   everyone when time is up.
6. ✅ **Enrollment + syllabus** — staff create subjects, enroll approved
   students, and upload a syllabus per subject (`/subjects`). Students see
   only subjects they're enrolled in. Syllabus is served for in-browser
   viewing only (`/subjects/:id/syllabus`) — worth reading the honesty note
   in `SyllabusViewer.jsx`: this is a soft deterrent (no download link,
   `Content-Disposition: inline`), not real protection. Nothing rendered on
   a screen can be made truly uncopyable.
7. ✅ **Subtitles/captions** — each speaker's own browser transcribes their
   own mic locally via the Web Speech API and broadcasts the text over
   Socket.io; other participants can toggle an overlay to see it
   (`Captions.jsx`). Chrome-only — the Web Speech API isn't reliably
   available elsewhere, and there's no free cross-browser alternative.
8. ✅ **Real database (Supabase Postgres)** — users, rooms, subjects,
   enrollments, and file metadata all persist across a server restart now.
   Live socket state (chat, hand-raise queue, who's currently connected)
   deliberately stays in-memory — it's tied to actual open connections, so
   there's nothing meaningful to persist there. Time-limit cutoffs are
   rescheduled from the database on every server start, so a restart no
   longer silently cancels a pending cutoff.

## What's next, in build order

9. **Attendance** and **quiz delivery** — intentionally skipped in this
   pass, per your last message.
10. **Move file bytes (uploads + recordings) to S3/GCS** — metadata is in
    Postgres now, but the actual files are still local disk, which doesn't
    survive a redeploy on most hosting platforms.
11. Harden reconnect handling (student's phone locks, wifi drops) —
    currently a disconnect just shows an error; a retry-with-backoff would
    make this much more forgiving on the low-bandwidth connections this
    product is meant for.

## Known limitations of this pass

- File bytes (uploads and recordings) are still local disk, not in
  Postgres or S3 — only their metadata persists. On most hosting platforms
  local disk doesn't survive a redeploy, so this is the next thing to fix.
- Recording requires your own S3-compatible bucket; there's no bundled
  storage.
- Moderation (mute/remove) requires LiveKit credentials to be set — without
  them the buttons no-op silently rather than erroring, since
  `roomService` is null in that case. Worth hardening with a clearer error
  once you're testing this against real LiveKit credentials.
- Captions only work in Chrome/Chromium browsers (Web Speech API support),
  and only caption whoever explicitly turns on "Caption my speech" for
  their own mic — there's no server-side transcription of remote audio.
- Syllabus "view only" is a soft deterrent, not enforcement — see the note
  in `SyllabusViewer.jsx`.
- Whiteboard is a single shared canvas with no persistence.
- No automated tests yet.
