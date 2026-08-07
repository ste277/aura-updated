// Sends the magic-link email via Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
// NOT testable in the build sandbox this project was built in — its network
// allowlist doesn't include api.resend.com (confirmed: a direct request there
// returns a proxy-level 403 with `x-deny-reason: host_not_allowed`, not a response
// from Resend itself). This will work normally in your actual deployment.
//
// Setup: sign up at resend.com, verify a sending domain (or use their shared
// onboarding domain for testing), set RESEND_API_KEY and RESEND_FROM_ADDRESS.

export async function sendMagicLinkEmail(toEmail: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'AuraSchedule <onboarding@resend.dev>';

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject: 'Your AuraSchedule sign-in link',
      html: buildEmailHtml(verifyUrl),
      text: `Sign in to AuraSchedule: ${verifyUrl}\n\nThis link expires in 15 minutes.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}

function buildEmailHtml(verifyUrl: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin-bottom: 8px;">Sign in to AuraSchedule</h2>
      <p style="color: #555; margin-bottom: 24px;">Click the button below. This link expires in 15 minutes.</p>
      <a href="${verifyUrl}"
         style="display: inline-block; padding: 12px 20px; background: #1f4d34; color: #4ade80;
                text-decoration: none; border-radius: 8px; font-weight: 600;">
        Sign in
      </a>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}
