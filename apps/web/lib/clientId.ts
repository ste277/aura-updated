/**
 * crypto.randomUUID() requires a secure context (HTTPS, or the literal host
 * "localhost") and throws otherwise — notably on Android's 10.0.2.2 dev
 * alias (AURA-MOBILE-01-M2-A/AND-01). crypto.getRandomValues() has no such
 * restriction and is available in every context Web Crypto itself is. This
 * produces a standard, format-identical RFC 4122 v4 UUID either way.
 */
export function generateClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through — some environments expose the function but still throw.
    }
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
