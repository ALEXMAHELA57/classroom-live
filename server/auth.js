import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import * as db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';

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
