import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import * as db from './db.js';
import * as emailer from './email.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';
const MIN_PASSWORD_LENGTH = 8;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export function isGoogleConfigured() {
  return Boolean(googleClient);
}

// Verifies a Google Identity Services credential (a signed JWT the
// browser gets directly from Google) and pulls out the account's email —
// this is what proves "this really is that Google account," not
// something the browser or a modified client could fake.
async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Google sign-in is not configured on this server');
  if (!credential) throw new Error('Missing Google credential');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google didn't provide an email for this account");
  if (!payload.email_verified) throw new Error("This Google account's email isn't verified");
  return { email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0] };
}

export const ROLES = ['student', 'staff', 'superadmin'];

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: Number(row.created_at),
  };
}

export async function listUsers() {
  const { rows } = await db.query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(toPublicUser);
}

export async function getUserById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

// Self-registration: always lands as 'pending' — even a staff signup needs
// a superadmin to approve it before they can log in.
export async function registerUser({ name, email, password, role }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name || !normalizedEmail || !password) {
    throw new Error('name, email, and password are required');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (await getUserByEmail(normalizedEmail)) {
    throw new Error('An account with that email already exists');
  }
  const safeRole = role === 'staff' ? 'staff' : 'student'; // self-signup can never grant superadmin
  const row = {
    id: nanoid(10),
    name,
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    role: safeRole,
    status: 'pending',
    createdAt: Date.now(),
  };
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, row.name, row.email, row.passwordHash, row.role, row.status, row.createdAt]
  );
  return toPublicUser({ ...row, created_at: row.createdAt });
}

// Superadmin-created accounts are approved immediately — the superadmin
// creating it *is* the approval.
export async function adminCreateUser({ name, email, password, role }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name || !normalizedEmail || !password || !ROLES.includes(role)) {
    throw new Error('name, email, password, and a valid role are required');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (await getUserByEmail(normalizedEmail)) {
    throw new Error('An account with that email already exists');
  }
  const row = {
    id: nanoid(10),
    name,
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    status: 'approved',
    createdAt: Date.now(),
  };
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, row.name, row.email, row.passwordHash, row.role, row.status, row.createdAt]
  );
  return toPublicUser({ ...row, created_at: row.createdAt });
}

export async function setUserStatus(userId, status) {
  const { rows } = await db.query(
    'UPDATE users SET status = $1 WHERE id = $2 RETURNING *',
    [status, userId]
  );
  if (!rows[0]) throw new Error('User not found');
  return toPublicUser(rows[0]);
}

export async function login({ email, password }) {
  const row = await getUserByEmail(String(email || '').trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    throw new Error('Invalid email or password');
  }
  if (row.status === 'pending') {
    throw new Error('Your account is awaiting admin approval');
  }
  if (row.status === 'disabled') {
    throw new Error('This account has been disabled');
  }
  const token = jwt.sign({ sub: row.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user: toPublicUser(row) };
}

// Signs in with an existing account using a verified Google identity.
// Google sign-in isn't a separate identity system — it just proves
// control of an email that must already match an account here.
export async function loginWithGoogle(credential) {
  const { email } = await verifyGoogleCredential(credential);
  const row = await getUserByEmail(email);
  if (!row) {
    throw new Error('No account found for this Google email — register first');
  }
  if (row.status === 'pending') throw new Error('Your account is awaiting admin approval');
  if (row.status === 'disabled') throw new Error('This account has been disabled');
  const token = jwt.sign({ sub: row.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user: toPublicUser(row) };
}

// Registers a brand-new account from a verified Google identity instead
// of a password. Still lands as 'pending', same as normal self-signup —
// Google verifying the email doesn't skip admin approval.
export async function registerWithGoogle(credential, role) {
  const { email, name } = await verifyGoogleCredential(credential);
  if (await getUserByEmail(email)) {
    throw new Error('An account with that email already exists — sign in instead');
  }
  const safeRole = role === 'staff' ? 'staff' : 'student'; // self-signup can never grant superadmin
  const row = {
    id: nanoid(10),
    name,
    email,
    // No password on a Google-only account. This random hash can't be
    // produced by anything the person could type, so password login
    // stays impossible for it — Google is the only way in, which is
    // correct since they never set a password.
    passwordHash: bcrypt.hashSync(nanoid(32), 10),
    role: safeRole,
    status: 'pending',
    createdAt: Date.now(),
  };
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, row.name, row.email, row.passwordHash, row.role, row.status, row.createdAt]
  );
  return toPublicUser({ ...row, created_at: row.createdAt });
}

export async function verifyToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  const row = await getUserById(payload.sub);
  if (!row) throw new Error('User not found');
  return toPublicUser(row);
}

// Express middleware: attaches req.user if the bearer token is valid,
// approved, and not disabled. Otherwise 401s/403s.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await verifyToken(token);
    if (user.status !== 'approved') {
      return res.status(403).json({ error: 'Account not approved' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    next();
  };
}

// Socket.io equivalent of requireAuth — same verification, no res object.
export async function verifySocketToken(token) {
  const user = await verifyToken(token);
  if (user.status !== 'approved') throw new Error('Account not approved');
  return user;
}

// Bootstraps a single superadmin from env vars on startup, so there's a
// way into the system before any accounts exist. Safe to call every
// startup — it's a no-op if that email already exists.
export async function ensureBootstrapSuperadmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password || !db.isConfigured()) return;
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) return;
  await adminCreateUser({ name: 'Super Admin', email: normalizedEmail, password, role: 'superadmin' });
  console.log(`[auth] Bootstrapped superadmin account: ${normalizedEmail}`);
}

export function isEmailConfigured() {
  return emailer.isEmailConfigured();
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Starts a self-service password reset. Always resolves without error
// regardless of whether the email matches an account — returning "no
// account with that email" would let anyone probe which emails are
// registered here, which is exactly the kind of thing a reset flow
// shouldn't leak.
export async function requestPasswordReset(email, resetBaseUrl) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const row = await getUserByEmail(normalizedEmail);
  if (!row) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at)
     VALUES ($1, $2, $3, $4, FALSE, $5)`,
    [nanoid(10), row.id, hashResetToken(rawToken), Date.now() + RESET_TOKEN_TTL_MS, Date.now()]
  );
  const resetUrl = `${resetBaseUrl}?token=${rawToken}`;
  await emailer.sendPasswordResetEmail(row.email, resetUrl);
}

// Completes a self-service reset — the raw token from the emailed link
// is hashed and compared against what's stored, so a leaked database
// alone was never enough to reset an account, only a leaked email.
export async function resetPassword(token, newPassword) {
  if (!token) throw new Error('Missing reset token');
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const { rows } = await db.query(
    `SELECT * FROM password_resets WHERE token_hash = $1 AND used = FALSE AND expires_at > $2`,
    [hashResetToken(token), Date.now()]
  );
  const resetRow = rows[0];
  if (!resetRow) throw new Error('This reset link is invalid or has expired — request a new one');

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRow.user_id]);
  await db.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [resetRow.id]);
}

// Superadmin resets a user's password directly — no email required.
// Works as a fallback when email sending isn't configured, or just
// faster when an admin is already helping the person directly.
export async function adminResetPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  const { rowCount } = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    passwordHash,
    userId,
  ]);
  if (rowCount === 0) throw new Error('User not found');
}
