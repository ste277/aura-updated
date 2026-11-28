/**
 * AURA-ANDROID-REL-04 (R4) -- page side of the service-worker compatibility
 * bridge (public/sw.js): pages of this bundle announce that they speak the
 * account boundary (so the worker never reloads them as out of date), and a
 * page the worker reloaded (?aura_reloaded=upgrade) can say so once.
 */
export const BOUNDARY_MESSAGE = { type: 'AURA_ACCOUNT_BOUNDARY', version: 1 } as const;
export const RELOADED_PARAM = 'aura_reloaded';

export function announceAccountBoundary(): void {
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const announce = () => sw.controller?.postMessage(BOUNDARY_MESSAGE);
    announce();
    sw.addEventListener?.('controllerchange', announce);
    // R5: a (re)started worker asks before treating a page as out of date; answer it.
    sw.addEventListener?.('message', (e: MessageEvent) => {
      const q = e.data as { type?: string; nonce?: string } | null;
      if (q?.type !== 'AURA_BOUNDARY_QUERY') return;
      // R6: the reply carries the query's nonce, tying it to that recovery check.
      const reply = { ...BOUNDARY_MESSAGE, nonce: q.nonce };
      const target = (e.source as ServiceWorker | null) ?? sw.controller;
      target?.postMessage?.(reply);
    });
    sw.startMessages?.();
  } catch {
    /* no service worker support */
  }
}

/** True (once) when this page was reloaded by the worker; removes the marker from the address. */
export function consumeReloadedNotice(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get(RELOADED_PARAM) !== 'upgrade') return false;
    u.searchParams.delete(RELOADED_PARAM);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    return true;
  } catch {
    return false;
  }
}
