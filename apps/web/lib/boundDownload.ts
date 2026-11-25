/**
 * AURA-ANDROID-REL-04 IR-01 (R4) -- user-initiated downloads (data export,
 * calendar file) bound to the account the user tapped under.
 *
 * A plain link navigation carries only the ambient cookie, so after an
 * unnoticed account change it would download the OTHER account's data. Here
 * the binding is captured at the tap, the request states that account
 * (X-Aura-Expected-Account, enforced by the server boundary), the body is read
 * inside the same lease, and the file is handed to the browser only if the
 * binding is still current when the body has arrived.
 */
import { AccountUnavailableError, isBindingCurrent, runActivityOperation, type AccountBinding, captureAccountBinding } from './accountSession';

export type BoundDownloadResult =
  | { status: 'saved' }
  | { status: 'account-changed' }
  | { status: 'unavailable'; reason: AccountUnavailableError['reason'] }
  | { status: 'upgrade-required' }
  | { status: 'failed'; httpStatus?: number };

export interface DownloadSink {
  save(blob: Blob, filename: string): void;
}

/** Default sink: object URL + temporary <a download>. */
export const browserDownloadSink: DownloadSink = {
  save(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  },
};

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="([^"]+)"/i.exec(cd);
  return m ? m[1] : fallback;
}

export async function downloadBound(
  url: string,
  fallbackName: string,
  { binding, sink = browserDownloadSink, fetchImpl = (i: string, n?: RequestInit) => fetch(i, n) }: { binding?: AccountBinding; sink?: DownloadSink; fetchImpl?: (i: string, n?: RequestInit) => Promise<Response> } = {}
): Promise<BoundDownloadResult> {
  let b: AccountBinding;
  try {
    b = binding ?? captureAccountBinding();
  } catch (e) {
    if (e instanceof AccountUnavailableError) return { status: 'unavailable', reason: e.reason };
    throw e;
  }
  try {
    return await runActivityOperation(async (lease) => {
      const res = await fetchImpl(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: lease.headers(), signal: lease.signal });
      if (!lease.isCurrent()) return { status: 'account-changed' } as const;
      if (res.status === 409) return { status: 'account-changed' } as const;
      if (!res.ok) {
        let code: unknown = null;
        try { code = ((await res.clone().json()) as { error?: unknown })?.error; } catch { code = null; }
        if (res.status === 503 && code === 'client_upgrade_required') return { status: 'upgrade-required' } as const;
        return { status: 'failed', httpStatus: res.status } as const;
      }
      const blob = await res.blob();
      // The body arrived; hand it over only if the account is still the one tapped under.
      if (!lease.isCurrent() || !isBindingCurrent(b)) return { status: 'account-changed' } as const;
      sink.save(blob, filenameFrom(res, fallbackName));
      return { status: 'saved' } as const;
    }, b);
  } catch (e) {
    if (e instanceof AccountUnavailableError) return e.reason === 'stale' ? { status: 'account-changed' } : { status: 'unavailable', reason: e.reason };
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError') return { status: 'account-changed' };
    return { status: 'failed' };
  }
}

export function downloadResultMessage(r: BoundDownloadResult): string | null {
  switch (r.status) {
    case 'saved': return null;
    case 'account-changed': return 'Your account changed, so nothing was downloaded. Try again from the account you want.';
    case 'unavailable': return r.reason === 'transition' ? 'Signing in or out. Try again in a moment.' : "Aura couldn't confirm which account is signed in. Try again.";
    case 'upgrade-required': return 'Aura was updated. Reload to continue.';
    case 'failed': return "The download didn't complete. Try again.";
  }
}
