'use client';

// Product Instrumentation V1 -- fire-and-forget client tracking helper.
// Never awaited by callers, never throws, never blocks the UI action it is
// attached to. See lib/productEvents.ts for the closed event vocabulary
// this posts to, and app/api/product-events/route.ts for the endpoint.
export function trackEvent(
  eventName: string,
  options?: { metadata?: Record<string, string | number | boolean>; auraMomentId?: string; momentToken?: string }
): void {
  try {
    fetch('/api/product-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName, ...options }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never break the feature it's attached to.
  }
}
