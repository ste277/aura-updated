/**
 * Derives a friendly display name from an email's local part -- the same
 * "Claude Preview Test" <- "claude-preview-test@example.com" logic the Home
 * dashboard's greeting has always used, extracted here so it can be reused
 * server-side (Aura Moment Sharing needs a sender display name that is safe
 * to put in a PUBLIC payload, without ever exposing the owner's actual
 * email address there -- see apps/web/lib/auraMoments.ts).
 */
export function formatDisplayName(email: string): string {
  const localPart = email.split('@')[0] || 'there';
  const withoutDigits = localPart.replace(/[0-9]+/g, '');
  const words = withoutDigits.split(/[._-]+/).filter(Boolean);
  const name = words.join(' ').trim() || localPart;
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
