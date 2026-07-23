// Mirrors the server's actual minimum (8 characters) so the meter never
// promises something the backend won't accept — scoring past that adds
// credit for length and character variety, purely as guidance.
function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

export function isPasswordValid(pw) {
  return Boolean(pw) && pw.length >= 8;
}

export default function PasswordStrength({ password }) {
  if (!password) return null;
  const score = scorePassword(password);
  return (
    <div className="password-strength">
      <div className="password-strength-bars">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`ps-bar ${i < score ? `ps-filled ps-s${score}` : ''}`} />
        ))}
      </div>
      <span className="password-strength-label">{LABELS[score]}</span>
    </div>
  );
}
