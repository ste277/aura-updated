/**
 * Quick Capture V1 PR C -- the Home composer's submit logic, kept pure so it
 * is testable without a component harness. Talks only to the existing
 * POST /api/captures (never Plan My Day / the Constructor), trims and
 * validates the title with the shared domain rule, and blocks synchronous
 * duplicate submission with a plain in-flight flag (a closure variable, so it
 * is visible to a second call in the same task -- React state is not).
 */
import { validateCaptureTitle } from './captures';

export type QuickCaptureResult = 'SAVED' | 'INVALID' | 'REJECTED' | 'FAILED' | 'BUSY';

export function createQuickCaptureSubmitter(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  let inFlight = false;
  return async function submit(rawTitle: string): Promise<QuickCaptureResult> {
    if (inFlight) return 'BUSY';
    const checked = validateCaptureTitle(rawTitle);
    if (!checked.ok) return 'INVALID';
    inFlight = true;
    try {
      const res = await fetchImpl('/api/captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: checked.title }) });
      const created = await res.json().catch(() => null);
      if (res.ok && created?.id) return 'SAVED';
      return res.status === 400 ? 'REJECTED' : 'FAILED';
    } catch {
      return 'FAILED';
    } finally {
      inFlight = false;
    }
  };
}
