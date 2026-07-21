import { nanoid } from 'nanoid';
import * as db from './db.js';

export async function getInstructions() {
  const { rows } = await db.query('SELECT * FROM billing_settings WHERE id = 1');
  return rows[0]?.instructions || '';
}

export async function setInstructions(instructions, adminId) {
  await db.query(
    `INSERT INTO billing_settings (id, instructions, updated_at)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET instructions = $1, updated_at = $2`,
    [instructions, Date.now()]
  );
  return instructions;
}

export async function addPayment({ studentId, amount, note, recordedBy }) {
  const row = {
    id: nanoid(10),
    studentId,
    amount: amount != null && amount !== '' ? Number(amount) : null,
    note: note || null,
    recordedBy,
    recordedAt: Date.now(),
  };
  await db.query(
    `INSERT INTO payments (id, student_id, amount, note, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.id, row.studentId, row.amount, row.note, row.recordedBy, row.recordedAt]
  );
  return row;
}

export async function deletePayment(paymentId) {
  await db.query('DELETE FROM payments WHERE id = $1', [paymentId]);
}

export async function listPaymentsForStudent(studentId) {
  const { rows } = await db.query(
    'SELECT * FROM payments WHERE student_id = $1 ORDER BY recorded_at DESC',
    [studentId]
  );
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount !== null ? Number(r.amount) : null,
    note: r.note,
    recordedAt: Number(r.recorded_at),
  }));
}

// Every approved student, with their paid/unpaid status — "paid" here just
// means "has at least one logged payment", not tied to any specific term
// or amount due. Simple by design: this is a ledger an admin annotates
// manually, not a billing system that calculates what's owed.
export async function listStudentsWithStatus() {
  const { rows } = await db.query(`
    SELECT
      u.id, u.name, u.email,
      COUNT(p.id) AS payment_count,
      COALESCE(SUM(p.amount), 0) AS total_paid,
      MAX(p.recorded_at) AS last_paid_at
    FROM users u
    LEFT JOIN payments p ON p.student_id = u.id
    WHERE u.role = 'student' AND u.status = 'approved'
    GROUP BY u.id, u.name, u.email
    ORDER BY u.name ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    paid: Number(r.payment_count) > 0,
    paymentCount: Number(r.payment_count),
    totalPaid: Number(r.total_paid),
    lastPaidAt: r.last_paid_at ? Number(r.last_paid_at) : null,
  }));
}
