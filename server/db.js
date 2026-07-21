import pg from 'pg';

const { Pool } = pg;

// Supabase is just hosted Postgres — this connects with the standard `pg`
// driver rather than Supabase's JS client, so it behaves like any other
// Postgres database. Get this connection string from your Supabase
// project: Settings → Database → Connection string (use the "Session
// pooler" or direct connection string, not the JS client's anon key).
const connectionString = process.env.SUPABASE_DB_URL;

export const pool = connectionString
  ? new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
  : null;

export function isConfigured() {
  return Boolean(pool);
}

export async function query(text, params) {
  if (!pool) {
    throw new Error('Database not configured — set SUPABASE_DB_URL in .env');
  }
  return pool.query(text, params);
}

// Idempotent — safe to run on every startup. Creates tables only if they
// don't already exist, so this never wipes existing data.
export async function initSchema() {
  if (!pool) {
    console.warn(
      '[db] SUPABASE_DB_URL is not set — accounts, rooms, subjects, and ' +
      'files will not persist across a server restart. Copy your Supabase ' +
      'connection string into .env to fix this.'
    );
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student', 'staff', 'superadmin')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'disabled')),
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_user_id TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL,
      ends_at BIGINT,
      ended BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS room_files (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size_bytes BIGINT,
      uploaded_by TEXT NOT NULL,
      uploaded_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      staff_id TEXT NOT NULL REFERENCES users(id),
      staff_name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      syllabus_filename TEXT,
      syllabus_original_name TEXT,
      syllabus_mime_type TEXT,
      syllabus_uploaded_at BIGINT,
      syllabus_text TEXT
    );

    CREATE TABLE IF NOT EXISTS subject_enrollments (
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (subject_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS room_recordings (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      egress_id TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('recording', 'completed', 'failed')),
      started_at BIGINT NOT NULL,
      ended_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      topic TEXT,
      questions JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      source_filename TEXT,
      source_original_name TEXT
    );

    CREATE TABLE IF NOT EXISTS quiz_submissions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answers JSONB NOT NULL,
      per_question JSONB NOT NULL,
      score NUMERIC NOT NULL,
      submitted_at BIGINT NOT NULL,
      UNIQUE (quiz_id, student_id)
    );

    -- Singleton row (id is always 1) holding the payment instructions text
    -- an admin writes once and every logged-in user sees.
    CREATE TABLE IF NOT EXISTS billing_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      instructions TEXT NOT NULL DEFAULT '',
      updated_at BIGINT NOT NULL,
      CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC,
      note TEXT,
      recorded_by TEXT NOT NULL REFERENCES users(id),
      recorded_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      rubric TEXT,
      due_at BIGINT,
      created_at BIGINT NOT NULL,
      source_filename TEXT,
      source_original_name TEXT,
      status TEXT NOT NULL DEFAULT 'published'
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text_answer TEXT,
      file_filename TEXT,
      file_original_name TEXT,
      score NUMERIC,
      feedback TEXT,
      submitted_at BIGINT NOT NULL,
      UNIQUE (assignment_id, student_id)
    );

    -- A student's own personal recording of themselves (mic/camera while
    -- toggled on), distinct from the room-level session recording. Only
    -- the student who made it, and whichever single staff member they
    -- choose to share it with, can access it.
    CREATE TABLE IF NOT EXISTS self_recordings (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      shared_with_staff_id TEXT REFERENCES users(id),
      shared_at BIGINT
    );
  `);

  // Columns added after a table already existed in earlier versions of
  // this app — CREATE TABLE IF NOT EXISTS above is a no-op once the table
  // is already there, so these need an explicit migration to reach
  // databases that were set up before this column existed.
  await pool.query(`
    ALTER TABLE subjects ADD COLUMN IF NOT EXISTS syllabus_text TEXT;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_filename TEXT;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_original_name TEXT;
    -- Draft/review workflow: teacher-generated (AI) and uploaded quizzes/
    -- assignments start as 'draft' and are hidden from students until the
    -- teacher reviews, optionally edits, and publishes them. Existing rows
    -- from before this column existed default to 'published' so nothing
    -- that was already live for students silently disappears.
    ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
    ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS source_filename TEXT;
    ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS source_original_name TEXT;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
  `);

  console.log('[db] Connected to Supabase and verified schema.');
}
