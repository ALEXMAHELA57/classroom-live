-- Classroom Live schema
-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run more than once — every statement is idempotent (IF NOT EXISTS).
-- This is the same schema the app creates automatically on first connect
-- (server/db.js) — running it here is optional, not required.

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

CREATE TABLE IF NOT EXISTS self_recordings (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  shared_with_staff_id TEXT REFERENCES users(id),
  shared_at BIGINT
);

-- If you're running this against a database that already has these
-- tables from an earlier version, run these too (safe to re-run):
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS syllabus_text TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_filename TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_original_name TEXT;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS source_filename TEXT;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS source_original_name TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
