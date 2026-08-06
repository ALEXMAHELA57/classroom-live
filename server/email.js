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

// Notifies every superadmin when a live class starts. Best-effort by
// design — the caller doesn't await failure here in a way that blocks
// the class from starting, since a notification problem shouldn't stop
// a teacher from teaching. Sends one email per recipient rather than a
// single multi-to email, so each admin's inbox shows it as addressed
// to them individually.
export async function sendSessionStartEmail(toEmails, { hostName, subjectName, joinUrl }) {
  if (!resend) throw new Error('Email sending is not configured on this server');
  const subject = subjectName ? `${hostName} started a ${subjectName} class` : `${hostName} started a class`;
  const results = await Promise.allSettled(
    toEmails.map((toEmail) =>
      resend.emails.send({
        from: EMAIL_FROM,
        to: toEmail,
        subject,
        html: `
          <p>${hostName} just started a live class${subjectName ? ` for <strong>${subjectName}</strong>` : ''} on Classroom Live.</p>
          <p><a href="${joinUrl}">Join or monitor the class</a></p>
        `,
      })
    )
  );
  const failures = results.filter((r) => r.status === 'rejected' || r.value?.error);
  if (failures.length === toEmails.length && toEmails.length > 0) {
    throw new Error('Could not send any session-start notification emails');
  }
}
