import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import TopBar from './TopBar.jsx';
import {
  getBillingInstructions,
  setBillingInstructions,
  listBillingStudents,
  listStudentPayments,
  addPayment,
  deletePayment,
} from '../lib/api.js';

export default function Billing() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [instructions, setInstructionsState] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/billing');
      return;
    }
    getBillingInstructions()
      .then((data) => setInstructionsState(data.instructions))
      .catch((err) => setError(err.message));
  }, [authLoading, user, navigate]);

  if (authLoading || !user) return null;

  return (
    <div className="page">
      <TopBar title="Billing" backTo="/" />
      <div className="admin-wrap">
        <h1>Billing</h1>
        {error && <p className="error">{error}</p>}

        {user.role === 'superadmin' ? (
          <InstructionsEditor initial={instructions} />
        ) : (
          <div className="card">
            <h3>Payment instructions</h3>
            {instructions ? (
              <p style={{ whiteSpace: 'pre-wrap' }}>{instructions}</p>
            ) : (
              <p className="muted">No payment instructions have been posted yet.</p>
            )}
          </div>
        )}

        {user.role === 'superadmin' && <StudentLedger />}
        {user.role === 'student' && <MyPayments userId={user.id} />}
      </div>
    </div>
  );
}

function InstructionsEditor({ initial }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setText(initial), [initial]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await setBillingInstructions(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3>Payment instructions</h3>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Shown to every logged-in user — bank details, mobile money number, accepted methods,
        whatever you want students to see. This is informational only; no payment actually
        happens through this app.
      </p>
      <textarea
        className="quiz-textarea"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Bank transfer to Account Name / Number / Bank, or mobile money to +xxx..."
      />
      <button onClick={save} disabled={saving}>
        {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save instructions'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function StudentLedger() {
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  async function refresh() {
    try {
      const data = await listBillingStudents();
      setStudents(data.students);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3>Student payment status</h3>
      {error && <p className="error">{error}</p>}
      {students.length === 0 && <p className="muted">No approved students yet.</p>}
      {students.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Total logged</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <StudentRow
                key={s.id}
                student={s}
                expanded={expandedId === s.id}
                onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                onChanged={refresh}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StudentRow({ student, expanded, onToggle, onChanged }) {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadPayments() {
    try {
      const data = await listStudentPayments(student.id);
      setPayments(data.payments);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (expanded) loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function logPayment(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await addPayment(student.id, { amount, note });
      setAmount('');
      setNote('');
      await loadPayments();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(paymentId) {
    try {
      await deletePayment(paymentId);
      await loadPayments();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <tr>
        <td>{student.name}</td>
        <td>
          <span className={`status-badge ${student.paid ? 'status-approved' : 'status-pending'}`}>
            {student.paid ? 'Paid' : 'Unpaid'}
          </span>
        </td>
        <td>{student.totalPaid > 0 ? student.totalPaid : '—'}</td>
        <td>
          <button className="ghost" onClick={onToggle}>
            {expanded ? 'Close' : 'Manage'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4}>
            {error && <p className="error">{error}</p>}
            <form onSubmit={logPayment} className="admin-create-form" style={{ marginBottom: 10 }}>
              <input
                placeholder="Amount (optional)"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" disabled={busy}>
                Log payment
              </button>
            </form>
            <ul className="roster-list">
              {payments.length === 0 && <p className="muted">No payments logged yet.</p>}
              {payments.map((p) => (
                <li key={p.id} className="file-row">
                  <span>
                    {new Date(p.recordedAt).toLocaleDateString()}
                    {p.amount ? ` — ${p.amount}` : ''}
                    {p.note ? ` — ${p.note}` : ''}
                  </span>
                  <button className="ghost" onClick={() => remove(p.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function MyPayments({ userId }) {
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listStudentPayments(userId)
      .then((data) => setPayments(data.payments))
      .catch((err) => setError(err.message));
  }, [userId]);

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3>Your payment history</h3>
      {error && <p className="error">{error}</p>}
      {payments.length === 0 && <p className="muted">No payments on record yet.</p>}
      <ul className="roster-list">
        {payments.map((p) => (
          <li key={p.id}>
            {new Date(p.recordedAt).toLocaleDateString()}
            {p.amount ? ` — ${p.amount}` : ''}
            {p.note ? ` — ${p.note}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
