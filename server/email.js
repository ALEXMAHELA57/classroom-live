import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend's free-tier default sender only delivers to your own verified
// Resend account email until you verify a domain you own — see
// resend.com/domains. Sending to arbitrary students/teachers requires
// that verification; until then this still works for testing against
// your own inbox.
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export function isEmailConfigured() {
  return Boolean(resend);
}

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!resend) throw new Error('Email sending is not configured on this server');
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: toEmail,
    subject: 'Reset your Classroom Live password',
    html: `
      <p>Someone requested a password reset for this account.</p>
      <p><a href="${resetUrl}">Click here to set a new password</a> — this link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `,
  });
  if (error) throw new Error(error.message || 'Failed to send email');
}
