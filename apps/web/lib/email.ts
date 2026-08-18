// Sign-in email delivery. Two providers, selected by which env vars are set:
//
//   mail-o-mail (preferred — shared with the Parley product, sends from a
//   verified @voyforge.com address):  MOM_API_KEY + MOM_FROM_EMAIL
//   Resend (fallback):                RESEND_API_KEY (+ RESEND_FROM_ADDRESS)
//
// Both are plain fetch calls — no SDK. Wire shape for mail-o-mail confirmed
// against Parley's working adapter: POST /api/v1/send, Bearer auth, JSON
// { to, subject, body (HTML), from_email_id }.

const MOM_DEFAULT_URL = 'https://mail-o-mail.com/api/v1/send';

/** True when at least one provider is configured — the route uses this to
 *  decide between real delivery and the dev-only inline fallback. */
export function isEmailConfigured(): boolean {
  return Boolean((process.env.MOM_API_KEY && process.env.MOM_FROM_EMAIL) || process.env.RESEND_API_KEY);
}

export async function sendMagicLinkEmail(toEmail: string, verifyUrl: string, code?: string): Promise<void> {
  const subject = code ? `${code} is your AuraSchedule sign-in code` : 'Your AuraSchedule sign-in link';
  const html = buildEmailHtml(verifyUrl, code);
  const text =
    `Sign in to AuraSchedule: ${verifyUrl}` +
    (code ? `\n\nOr enter this code in the app: ${code}` : '') +
    `\n\nThis link and code expire in 15 minutes.`;

  if (process.env.MOM_API_KEY && process.env.MOM_FROM_EMAIL) {
    return sendViaMailOMail({ to: toEmail, subject, html });
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to: toEmail, subject, html, text });
  }
  throw new Error('No email provider configured (set MOM_API_KEY+MOM_FROM_EMAIL or RESEND_API_KEY).');
}

async function sendViaMailOMail(msg: { to: string; subject: string; html: string }): Promise<void> {
  const url = process.env.MOM_API_URL || MOM_DEFAULT_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MOM_API_KEY}`,
    },
    body: JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      body: msg.html,
      from_email_id: process.env.MOM_FROM_EMAIL,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`mail-o-mail ${res.status}: ${detail.slice(0, 200)}`);
  }
}

async function sendViaResend(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'AuraSchedule <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body.slice(0, 200)}`);
  }
}

function buildEmailHtml(verifyUrl: string, code?: string): string {
  const codeBlock = code
    ? `
      <p style="color: #555; margin: 24px 0 8px;">On the mobile app? Enter this code instead:</p>
      <div style="font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px;
                  background: #f4f4f5; border-radius: 8px; padding: 12px 20px; display: inline-block;">
        ${code}
      </div>`
    : '';
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin-bottom: 8px;">Sign in to AuraSchedule</h2>
      <p style="color: #555; margin-bottom: 24px;">Click the button below. This link and code expire in 15 minutes.</p>
      <a href="${verifyUrl}"
         style="display: inline-block; padding: 12px 20px; background: #1f4d34; color: #4ade80;
                text-decoration: none; border-radius: 8px; font-weight: 600;">
        Sign in
      </a>
      ${codeBlock}
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}
