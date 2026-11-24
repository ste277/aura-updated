/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 -- the one client-side account boundary,
 * shared by Home, /find and every activity write (web, Android and iOS
 * shells all load this same bundle).
 *
 * It owns four things:
 *
 *  1. The VERIFIED account of this tab: the user id from the latest
 *     GET /api/auth/session answer that was still current when it arrived.
 *     `undefined` = not verified yet, `null` = verified signed out.
 *  2. An EPOCH that changes whenever that verified account changes (sign-out,
 *     sign-in, account switch, session expiry, another tab's transition).
 *     Async work captures the epoch it started under; a completion whose
 *     epoch is no longer current is discarded. Home keys its whole dashboard
 *     on the epoch, so account-scoped state and caches start empty for the
 *     next account.
 *  3. A single-flight AUTH TRANSITION (sign-out). While it runs, new activity
 *     writes and replays are refused, in-flight replays are aborted, and other
 *     tabs see a transition marker and suspend too.
 *  4. Tracked ACTIVITY OPERATIONS, so a sign-out can wait until no activity
 *     write is still in flight before it counts the unsynced work.
 *
 * This module never authorizes anything. The account id it holds only
 * becomes the `X-Aura-Expected-Account` header, which the server compares
 * with the authenticated session (lib/expectedAccount.ts); a mismatch is
 * rejected before anything is written. Client-side cancellation is a
 * convenience; the server check is the guarantee.
 */

export const EXPECTED_ACCOUNT_HEADER = 'X-Aura-Expected-Account';
export const TRANSITION_STORAGE_KEY = 'aura_account_transition_v1';
/** A cross-tab "signing out" marker older than this is ignored (the tab that wrote it died). */
export const TRANSITION_MARKER_TTL_MS = 30_000;

type VerifiedAccount = string | null | undefined;

interface State {
  epoch: number;
  account: VerifiedAccount;
  transition: { id: string; startedAt: number } | null;
}

const state: State = { epoch: 0, account: undefined, transition: null };
const listeners = new Set<() => void>();
const inFlight = new Set<Promise<unknown>>();
const controllers = new Set<AbortController>();
let tabId = Math.random().toString(36).slice(2);
let storageListenerInstalled = false;

export class AccountUnavailableError extends Error {
  constructor(public readonly reason: 'unverified' | 'signed-out' | 'transition' | 'stale') {
    super(
      reason === 'transition'
        ? 'Signing out. Try again in a moment.'
        : reason === 'stale'
          ? 'Your account changed. Nothing was saved.'
          : 'You are not signed in.'
    );
    this.name = 'AccountUnavailableError';
  }
}

function notify() {
  for (const l of [...listeners]) {
    try { l(); } catch { /* a listener must not break the others */ }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function writeMarker(value: object | null) {
  const s = safeStorage();
  if (!s) return;
  try {
    if (value) s.setItem(TRANSITION_STORAGE_KEY, JSON.stringify(value));
    else s.removeItem(TRANSITION_STORAGE_KEY);
  } catch {
    // Storage failing: this tab still enforces its own transition; other
    // tabs fall back to the server check.
  }
}

function readMarker(): { kind?: string; tab?: string; at?: number } | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(TRANSITION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function bumpEpoch(nextAccount: VerifiedAccount) {
  state.epoch += 1;
  state.account = nextAccount;
  // Old-account work stops: in-flight replays/writes are aborted. Their
  // completions are discarded by the epoch check anyway; aborting saves the
  // network and makes the server boundary the last line, not the only one.
  for (const c of [...controllers]) c.abort();
  notify();
}

/** Another tab announced a transition or an account change. */
function onStorage(e: StorageEvent) {
  if (e.key !== TRANSITION_STORAGE_KEY) return;
  let value: { kind?: string; tab?: string } | null = null;
  try { value = e.newValue ? JSON.parse(e.newValue) : null; } catch { value = null; }
  if (value && value.tab === tabId) return;
  if (value?.kind === 'signing-out') {
    // Suspend: abort in-flight work; account stays until the outcome is known.
    for (const c of [...controllers]) c.abort();
    notify();
    return;
  }
  if (value?.kind === 'resumed') { notify(); return; }
  // Another tab verified an account: only a DIFFERENT account matters.
  if (value?.kind === 'account-verified' && 'account' in (value as object)) {
    if ((value as { account?: unknown }).account === state.account) return;
  }
  // 'signed-out', 'account-changed', a different verified account, or the
  // marker removed: forget the account and re-verify.
  bumpEpoch(undefined);
}

function ensureStorageListener() {
  if (storageListenerInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', onStorage);
  storageListenerInstalled = true;
}

export function subscribeAccount(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAccountEpoch(): number { return state.epoch; }
export function getVerifiedAccount(): VerifiedAccount { return state.account; }

/** True while this tab, or (within the TTL) another tab, is signing out. */
export function isTransitionActive(now = Date.now()): boolean {
  if (state.transition) return true;
  const m = readMarker();
  return Boolean(m && m.kind === 'signing-out' && m.tab !== tabId && typeof m.at === 'number' && now - m.at < TRANSITION_MARKER_TTL_MS);
}

/**
 * Records a verified session answer. Changing the account (A -> B, A -> null,
 * null -> A) bumps the epoch and tells other tabs. The first answer
 * (undefined -> X) does not bump.
 */
export function setVerifiedAccount(account: string | null, { broadcast = true } = {}) {
  const prev = state.account;
  if (prev === account) return;
  if (prev === undefined) {
    state.account = account;
    notify();
  } else {
    bumpEpoch(account);
  }
  // Tell other tabs which account this device's session now belongs to; a
  // tab that still believes in a different account re-verifies.
  if (broadcast) writeMarker({ kind: 'account-verified', account, tab: tabId, at: Date.now() });
}

export type SessionCheck =
  | { status: 'current'; user: { id: string } & Record<string, unknown>; payload: Record<string, unknown> }
  | { status: 'signed-out'; payload: Record<string, unknown> | null }
  | { status: 'stale' }
  | { status: 'error' };

/**
 * GET /api/auth/session through the boundary. The answer is applied only if
 * no transition started and the epoch did not change while it was in flight
 * (a late answer can never restore a previous account); otherwise 'stale'.
 */
export async function fetchVerifiedSession(fetchImpl: typeof fetch = fetch): Promise<SessionCheck> {
  if (isTransitionActive()) return { status: 'stale' };
  const epoch = state.epoch;
  let payload: Record<string, unknown> | null;
  try {
    const res = await fetchImpl('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return epoch === state.epoch ? { status: 'error' } : { status: 'stale' };
    payload = await res.json().catch(() => null);
  } catch {
    return epoch === state.epoch ? { status: 'error' } : { status: 'stale' };
  }
  if (epoch !== state.epoch || isTransitionActive()) return { status: 'stale' };
  const user = payload && typeof payload === 'object' ? (payload as { user?: unknown }).user : null;
  if (user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string') {
    setVerifiedAccount((user as { id: string }).id);
    return { status: 'current', user: user as { id: string } & Record<string, unknown>, payload: payload as Record<string, unknown> };
  }
  if (payload && typeof payload === 'object' && 'user' in payload) {
    setVerifiedAccount(null);
    return { status: 'signed-out', payload };
  }
  return { status: 'error' };
}

/**
 * Re-verifies the session whenever the page returns to the foreground (tab
 * shown again; Capacitor's resume also fires visibilitychange in the
 * WebView). Session expiry or an account change made elsewhere is noticed
 * then, and moves this tab to a new epoch. Returns the cleanup.
 */
export function startForegroundReverification(fetchImpl?: typeof fetch): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
  const handler = () => {
    if (document.visibilityState !== 'visible' || state.account === undefined) return;
    void fetchVerifiedSession(fetchImpl ?? ((input, init) => fetch(input, init)));
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export interface AccountLease {
  account: string;
  epoch: number;
  signal: AbortSignal;
  /** Still the same verified account and epoch, and no transition. */
  isCurrent(): boolean;
  headers(extra?: Record<string, string>): Record<string, string>;
}

/**
 * Runs one account-scoped activity operation. Refused (AccountUnavailableError)
 * without a verified account or during a transition. The operation is tracked
 * so a sign-out can wait for it, and aborted when the account changes.
 */
export async function runActivityOperation<T>(op: (lease: AccountLease) => Promise<T>): Promise<T> {
  const account = state.account;
  if (isTransitionActive()) throw new AccountUnavailableError('transition');
  if (account === undefined) throw new AccountUnavailableError('unverified');
  if (account === null) throw new AccountUnavailableError('signed-out');
  const epoch = state.epoch;
  const controller = new AbortController();
  controllers.add(controller);
  const lease: AccountLease = {
    account,
    epoch,
    signal: controller.signal,
    isCurrent: () => state.epoch === epoch && state.account === account && !isTransitionActive() && !controller.signal.aborted,
    headers: (extra = {}) => ({ ...extra, [EXPECTED_ACCOUNT_HEADER]: account }),
  };
  const p = (async () => op(lease))();
  inFlight.add(p);
  try {
    return await p;
  } finally {
    inFlight.delete(p);
    controllers.delete(controller);
  }
}

/** Resolves true once no activity operation is in flight, false on timeout. */
export async function settleActivityOperations(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), remaining); });
    const settled = Promise.allSettled([...inFlight]).then(() => 'settled' as const);
    const winner = await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);
    if (winner === 'timeout' && inFlight.size > 0) return false;
  }
  return true;
}

export interface TransitionHandle {
  readonly id: string;
  /** Ends the transition. 'signed-out' and 'switched' change the account (new epoch); 'resumed' keeps it; 'unknown' requires re-verification. */
  end(outcome: 'signed-out' | 'resumed' | 'unknown' | { switchedTo: string }): void;
}

/** Starts the single auth transition, or returns null if one is already running in this tab. */
export function beginTransition(): TransitionHandle | null {
  if (state.transition) return null;
  const id = `${tabId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  state.transition = { id, startedAt: Date.now() };
  for (const c of [...controllers]) c.abort();
  writeMarker({ kind: 'signing-out', tab: tabId, at: Date.now() });
  notify();
  let ended = false;
  return {
    id,
    end(outcome) {
      if (ended) return;
      ended = true;
      state.transition = null;
      if (outcome === 'resumed') {
        writeMarker({ kind: 'resumed', tab: tabId, at: Date.now() });
        notify();
      } else if (outcome === 'signed-out') {
        writeMarker({ kind: 'signed-out', tab: tabId, at: Date.now() });
        bumpEpoch(null);
      } else if (outcome === 'unknown') {
        writeMarker({ kind: 'signed-out', tab: tabId, at: Date.now() });
        bumpEpoch(undefined);
      } else {
        writeMarker({ kind: 'account-changed', tab: tabId, at: Date.now() });
        bumpEpoch(outcome.switchedTo);
      }
    },
  };
}

/** Test-only: reset module state between scenarios (simulates a fresh tab). */
export function __resetAccountSessionForTests(newTabId?: string) {
  state.epoch = 0;
  state.account = undefined;
  state.transition = null;
  listeners.clear();
  inFlight.clear();
  controllers.clear();
  storageListenerInstalled = false;
  if (newTabId) tabId = newTabId;
}
/** Test-only: deliver a cross-tab storage event. */
export function __deliverStorageEventForTests(e: { key: string | null; newValue: string | null }) {
  onStorage(e as StorageEvent);
}
