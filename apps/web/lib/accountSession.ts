/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 -- the one client-side account boundary,
 * shared by every surface (web, Android and iOS shells load this bundle).
 *
 * Invariants (R2):
 *  I1  The VERIFIED account is only ever set from a session answer that was
 *      the newest session request started AND arrived with no intervening
 *      account change, transition or cross-tab event (`gen` unchanged).
 *  I2  `epoch` changes whenever the verified account changes to a different
 *      known value or is invalidated; Home is keyed on it, so account-scoped
 *      UI state never survives an account change.
 *  I3  Account-bound work (activity and plan writes, replay) runs only with a
 *      verified account, outside any auth transition (this tab or another),
 *      and is aborted when the account changes or a transition starts. It is
 *      bound to the account that was current when the USER ACTED
 *      (captureAccountBinding) and refused if that is no longer current.
 *  I4  The server is the guarantee: every bound request states its account
 *      (X-Aura-Expected-Account) and is refused if the session differs
 *      (lib/expectedAccount.ts, middleware.ts). Nothing here authorizes.
 *  I5  Sign-in and sign-out run under ONE auth lock across tabs (Web Locks;
 *      fallback below), so an old logout response can't clear a newer
 *      sign-in in a coordinated flow.
 *  I6  When verification is unavailable the account stays UNVERIFIED
 *      (undefined): bound writes are refused, pending work is kept, and the
 *      UI offers a retry.
 *
 * Without Web Locks (old iOS WebViews), cross-tab exclusion falls back to a
 * versioned, heart-beaten storage marker: a tab never starts sign-in or
 * sign-out while another tab's fresh marker exists. Two tabs starting in the
 * same instant can still both proceed; the server account checks keep that
 * from writing into the wrong account.
 */

export const EXPECTED_ACCOUNT_HEADER = 'X-Aura-Expected-Account';
export const TRANSITION_STORAGE_KEY = 'aura_auth_transition_v2';
export const ANNOUNCE_STORAGE_KEY = 'aura_account_announce_v2';
/** A cross-tab transition marker older than this is ignored (its tab died); live owners refresh it. */
export const TRANSITION_MARKER_TTL_MS = 15_000;
export const TRANSITION_HEARTBEAT_MS = 4_000;
export const SESSION_CHECK_TIMEOUT_MS = 10_000;
export const AUTH_LOCK_NAME = 'aura-auth-transition';

type VerifiedAccount = string | null | undefined;

interface State {
  epoch: number;
  gen: number;
  account: VerifiedAccount;
  transition: { id: string; startedAt: number } | null;
}

const state: State = { epoch: 0, gen: 0, account: undefined, transition: null };
const listeners = new Set<() => void>();
const inFlight = new Set<Promise<unknown>>();
const controllers = new Set<AbortController>();
let tabId = Math.random().toString(36).slice(2);
let storageListenerInstalled = false;
let sessionReqSeq = 0;

export class AccountUnavailableError extends Error {
  constructor(public readonly reason: 'unverified' | 'signed-out' | 'transition' | 'stale') {
    super(
      reason === 'transition'
        ? 'Signing in or out. Try again in a moment.'
        : reason === 'stale'
          ? 'Your account changed. Nothing was saved for the new account.'
          : reason === 'unverified'
            ? "Aura couldn't confirm which account is signed in. Check your connection and try again."
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
/** Writes (or removes) a coordination key and reads it back; false when storage failed. */
function writeKey(key: string, value: object | null): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    if (value) {
      const v = JSON.stringify(value);
      s.setItem(key, v);
      return s.getItem(key) === v;
    }
    s.removeItem(key);
    return s.getItem(key) === null;
  } catch {
    // Storage failing: this tab still enforces its own state; with Web Locks
    // other tabs still see the held auth lock; the server checks cover the rest.
    return false;
  }
}
function readKey<T>(key: string): T | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function abortAll() {
  for (const c of [...controllers]) c.abort();
}

function bumpEpoch(nextAccount: VerifiedAccount) {
  state.epoch += 1;
  state.gen += 1;
  state.account = nextAccount;
  abortAll();
  notify();
}

/** Forget the verified account (it must be re-verified); used on cross-tab news and server account mismatches. */
export function invalidateAccount() {
  bumpEpoch(undefined);
}

type TransitionMarker = { kind: 'signing-out' | 'signing-in' | 'ended'; tx: string; tab: string; at: number; outcome?: string };
type Announce = { account: string | null; tab: string; at: number };

function onStorage(e: { key: string | null; newValue: string | null }) {
  if (e.key === TRANSITION_STORAGE_KEY) {
    let m: TransitionMarker | null = null;
    try { m = e.newValue ? JSON.parse(e.newValue) : null; } catch { m = null; }
    if (m && m.tab === tabId) return;
    if (m && (m.kind === 'signing-out' || m.kind === 'signing-in')) {
      // Another tab owns the auth transition: suspend bound work here.
      state.gen += 1;
      abortAll();
      notify();
      return;
    }
    if (m && m.kind === 'ended' && (m.outcome === 'resumed' || m.outcome === 'resumed-verified')) {
      // The other tab's transition changed nothing.
      state.gen += 1;
      notify();
      return;
    }
    // Ended with any other outcome, or removed: re-verify before bound work.
    bumpEpoch(undefined);
    return;
  }
  if (e.key === ANNOUNCE_STORAGE_KEY) {
    let a: Announce | null = null;
    try { a = e.newValue ? JSON.parse(e.newValue) : null; } catch { a = null; }
    if (!a || a.tab === tabId) return;
    if (a.account === state.account) return;
    bumpEpoch(undefined);
  }
}

function ensureStorageListener() {
  if (storageListenerInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', (e) => onStorage(e));
  storageListenerInstalled = true;
}

export function subscribeAccount(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAccountEpoch(): number { return state.epoch; }
export function getVerifiedAccount(): VerifiedAccount { return state.account; }

function foreignMarkerActive(now = Date.now()): boolean {
  const m = readKey<TransitionMarker>(TRANSITION_STORAGE_KEY);
  return Boolean(m && (m.kind === 'signing-out' || m.kind === 'signing-in') && m.tab !== tabId && typeof m.at === 'number' && now - m.at < TRANSITION_MARKER_TTL_MS);
}

/** True while this tab, or (fresh marker) another tab, is signing in or out. Synchronous best view. */
export function isTransitionActive(now = Date.now()): boolean {
  return Boolean(state.transition) || foreignMarkerActive(now);
}

/**
 * AURA-ANDROID-REL-04 IR-03 (R3) -- the authoritative cross-tab check used
 * before any account-bound request is sent. With Web Locks the held auth lock
 * itself is consulted (independent of the storage marker, which may be
 * unwritable or stale); without them, the heart-beaten marker is the signal.
 */
export async function isTransitionActiveNow(): Promise<boolean> {
  if (isTransitionActive()) return true;
  const locks = lockManager() as (LockManagerLike & { query?: () => Promise<{ held?: Array<{ name?: string }> }> }) | null;
  if (locks && typeof locks.query === 'function') {
    try {
      const snapshot = await locks.query();
      if ((snapshot.held ?? []).some((l) => l.name === AUTH_LOCK_NAME)) return true;
    } catch {
      // Query unavailable: fall back to the marker (already checked).
    }
  }
  return false;
}

// ------------------------------------------------------------------ upgrade signal
let upgradeRequired = false;
/** A request was refused with client_upgrade_required: the UI should offer a reload. */
export function reportUpgradeRequired() {
  if (upgradeRequired) return;
  upgradeRequired = true;
  notify();
}
export function isUpgradeRequired(): boolean { return upgradeRequired; }

/**
 * Records a verified session answer. Any change advances `gen` (so older
 * in-flight session answers become stale); a change between two KNOWN values
 * also advances the epoch. Other tabs are told which account this device's
 * session now belongs to.
 */
export function setVerifiedAccount(account: string | null, { broadcast = true } = {}) {
  const prev = state.account;
  if (prev === account) return;
  if (prev === undefined) {
    state.account = account;
    state.gen += 1;
    notify();
  } else {
    bumpEpoch(account);
  }
  if (broadcast) writeKey(ANNOUNCE_STORAGE_KEY, { account, tab: tabId, at: Date.now() });
}

export type SessionCheck =
  | { status: 'current'; user: { id: string } & Record<string, unknown>; payload: Record<string, unknown> }
  | { status: 'signed-out'; payload: Record<string, unknown> }
  | { status: 'stale' }
  | { status: 'error' };

/** `application/json` as the actual media type (parameters allowed), not a substring. */
export function isJsonMediaType(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

export type SessionAnswer = { kind: 'user'; id: string; payload: Record<string, unknown> } | { kind: 'none'; payload: Record<string, unknown> };

/** Strict reading of GET /api/auth/session: 200, application/json, `{ user: null | { id: non-empty string } }`. */
export async function readSessionAnswer(res: Response): Promise<SessionAnswer | null> {
  if (res.status !== 200 || res.redirected || res.type === 'opaqueredirect') return null;
  if (!isJsonMediaType(res.headers?.get?.('content-type'))) return null;
  let body: unknown;
  try { body = await res.json(); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('user' in body)) return null;
  const user = (body as { user: unknown }).user;
  if (user === null) return { kind: 'none', payload: body as Record<string, unknown> };
  if (user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string' && (user as { id: string }).id) {
    return { kind: 'user', id: (user as { id: string }).id, payload: body as Record<string, unknown> };
  }
  return null;
}

export const DEADLINE = Symbol('deadline');

/** Races a promise against a deadline; the result always settles. */
export async function withDeadline<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<typeof DEADLINE>((r) => { timer = setTimeout(() => { onTimeout?.(); r(DEADLINE); }, ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One bounded request + body read: fetch with an abort on the deadline, then
 * `read(res)` within what is left of it. Resolves to DEADLINE, the read
 * result, or throws the fetch error.
 */
export async function boundedExchange<T>(fetchImpl: typeof fetch, input: string, init: RequestInit, ms: number, read: (res: Response) => Promise<T>, extraSignal?: AbortSignal): Promise<T | typeof DEADLINE> {
  const controller = new AbortController();
  const onExtra = () => controller.abort();
  extraSignal?.addEventListener('abort', onExtra, { once: true });
  try {
    return await withDeadline((async () => read(await fetchImpl(input, { ...init, signal: controller.signal })))(), ms, () => controller.abort());
  } finally {
    extraSignal?.removeEventListener('abort', onExtra);
  }
}

/**
 * GET /api/auth/session through the boundary (I1). The answer is applied
 * only if it belongs to the NEWEST session request and nothing account-
 * related happened while it was in flight. A caller whose own answer went
 * stale is not left without one: it follows the newest request's answer, or
 * (if the state changed with no newer request, e.g. a cancelled transition)
 * re-checks, at most twice. 'stale' is returned only when it still can't get
 * a current answer (e.g. a transition is running). Every request is bounded.
 */
let latestSession: { seq: number; promise: Promise<SessionCheck> } | null = null;

export async function fetchVerifiedSession(fetchImpl: typeof fetch = (i, n) => fetch(i, n), { duringOwnTransition = false } = {}): Promise<SessionCheck> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!duringOwnTransition && isTransitionActive()) return { status: 'stale' };
    const mine = sessionRequest(fetchImpl, duringOwnTransition);
    const r = await mine.promise;
    if (r.status !== 'stale') return r;
    // Follow a newer request if one is in flight.
    if (latestSession && latestSession.seq > mine.seq) {
      const newer = await latestSession.promise;
      if (newer.status !== 'stale') return newer;
    }
  }
  return { status: 'stale' };
}

function sessionRequest(fetchImpl: typeof fetch, duringOwnTransition: boolean): { seq: number; promise: Promise<SessionCheck> } {
  const myReq = ++sessionReqSeq;
  const gen0 = state.gen;
  const controller = new AbortController();
  controllers.add(controller);
  const isFresh = () => myReq === sessionReqSeq && gen0 === state.gen && !controller.signal.aborted && (duringOwnTransition || !isTransitionActive());
  const promise = (async (): Promise<SessionCheck> => {
    let answer: SessionAnswer | null = null;
    try {
      const r = await boundedExchange(fetchImpl, '/api/auth/session', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }, SESSION_CHECK_TIMEOUT_MS, readSessionAnswer, controller.signal);
      answer = r === DEADLINE ? null : r;
    } catch {
      answer = null;
    } finally {
      controllers.delete(controller);
    }
    if (!isFresh()) return { status: 'stale' };
    if (!answer) return { status: 'error' };
    if (answer.kind === 'user') {
      setVerifiedAccount(answer.id);
      const user = (answer.payload as { user: { id: string } & Record<string, unknown> }).user;
      return { status: 'current', user, payload: answer.payload };
    }
    setVerifiedAccount(null);
    return { status: 'signed-out', payload: answer.payload };
  })();
  latestSession = { seq: myReq, promise };
  return latestSession;
}

let ensureInFlight: Promise<VerifiedAccount> | null = null;
/**
 * AURA-ANDROID-REL-04 (R3) -- for a request that needs the verified account
 * while it is unknown: one shared verification (deduplicated), then the
 * account (string, null = signed out) or undefined when it still can't be
 * verified. Never forwards on a guess.
 */
export async function ensureVerifiedAccount(fetchImpl?: typeof fetch): Promise<VerifiedAccount> {
  if (state.account !== undefined) return state.account;
  if (!ensureInFlight) {
    ensureInFlight = fetchVerifiedSession(fetchImpl).then(() => state.account).finally(() => { ensureInFlight = null; });
  }
  return ensureInFlight;
}

/**
 * Re-verifies when the page returns to the foreground (Capacitor's resume
 * fires visibilitychange in the WebView). Returns the cleanup.
 */
export function startForegroundReverification(fetchImpl?: typeof fetch): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
  const handler = () => {
    if (document.visibilityState !== 'visible') return;
    void fetchVerifiedSession(fetchImpl);
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

// ------------------------------------------------------------------ bound work

/** The account (and epoch) the user acted under, captured at the moment of the action. */
export interface AccountBinding {
  readonly account: string;
  readonly epoch: number;
}

/** Captures the binding for a user action. Throws AccountUnavailableError if there is no verified account or a transition is running. */
export function captureAccountBinding(): AccountBinding {
  if (isTransitionActive()) throw new AccountUnavailableError('transition');
  if (state.account === undefined) throw new AccountUnavailableError('unverified');
  if (state.account === null) throw new AccountUnavailableError('signed-out');
  return { account: state.account, epoch: state.epoch };
}

export function isBindingCurrent(b: AccountBinding): boolean {
  return state.account === b.account && state.epoch === b.epoch && !isTransitionActive();
}

export interface AccountLease extends AccountBinding {
  signal: AbortSignal;
  /** Still the bound account and epoch, no transition, not aborted. */
  isCurrent(): boolean;
  headers(extra?: Record<string, string>): Record<string, string>;
}

/**
 * Runs one account-bound operation (I3). Refused when the binding (default:
 * captured now) is no longer current. Tracked so a sign-out can wait for it,
 * and aborted when the account changes or a transition starts. Aborting a
 * request never proves the server did not commit it.
 */
export async function runActivityOperation<T>(op: (lease: AccountLease) => Promise<T>, binding?: AccountBinding): Promise<T> {
  const b = binding ?? captureAccountBinding();
  if (!isBindingCurrent(b)) {
    if (isTransitionActive()) throw new AccountUnavailableError('transition');
    throw new AccountUnavailableError('stale');
  }
  // Cross-tab: also consult the held auth lock (not only the storage marker).
  if (await isTransitionActiveNow()) throw new AccountUnavailableError('transition');
  if (!isBindingCurrent(b)) throw new AccountUnavailableError('stale');
  const controller = new AbortController();
  controllers.add(controller);
  const lease: AccountLease = {
    account: b.account,
    epoch: b.epoch,
    signal: controller.signal,
    isCurrent: () => isBindingCurrent(b) && !controller.signal.aborted,
    headers: (extra = {}) => ({ ...extra, [EXPECTED_ACCOUNT_HEADER]: b.account }),
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

/** Resolves true once no bound operation is in flight, false on timeout. */
export async function settleActivityOperations(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const r = await withDeadline(Promise.allSettled([...inFlight]), remaining);
    if (r === DEADLINE && inFlight.size > 0) return false;
  }
  return true;
}

// ------------------------------------------------------------------ auth transitions

type LockManagerLike = { request: <T>(name: string, opts: { mode?: 'exclusive'; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T>) => Promise<T> };
export function lockManager(): LockManagerLike | null {
  try {
    const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
    return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
  } catch {
    return null;
  }
}

/**
 * Runs `fn` as THE auth transition of this browser (I5): exclusive across tabs
 * via Web Locks; without them, refused while another tab's fresh marker
 * exists. Returns null if refused (another transition owns the lock).
 */
export async function withAuthLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = lockManager();
  if (locks) {
    return locks.request(AUTH_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => (lock ? fn() : null));
  }
  if (foreignMarkerActive()) return null;
  return fn();
}

let coordination: { markerWritten: boolean; webLocks: boolean } = { markerWritten: true, webLocks: false };
/** How the current/last transition could coordinate with other tabs. */
export function getTransitionCoordination() { return coordination; }

export type TransitionOutcome = 'signed-out' | 'resumed' | 'resumed-verified' | 'unknown' | { switchedTo: string };

export interface TransitionHandle {
  readonly id: string;
  /**
   * Ends the transition.
   *  - 'resumed': nothing reached the server (cancel / never sent): account kept.
   *  - 'resumed-verified': a fresh session answer during the transition said the same account.
   *  - 'signed-out' / { switchedTo }: account changed (new epoch).
   *  - 'unknown': verification unavailable -> account UNVERIFIED (I6).
   */
  end(outcome: TransitionOutcome): void;
}

/** Starts this tab's auth transition (call inside withAuthLock), or null if one is already running here. */
export function beginTransition(kind: 'signing-out' | 'signing-in' = 'signing-out'): TransitionHandle | null {
  if (state.transition) return null;
  const id = `${tabId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  state.transition = { id, startedAt: Date.now() };
  state.gen += 1;
  abortAll();
  const mark = () => writeKey(TRANSITION_STORAGE_KEY, { kind, tx: id, tab: tabId, at: Date.now() } satisfies TransitionMarker);
  // Coordination health: without Web Locks the marker is the only cross-tab
  // signal; if it can't be written, other tabs can't be suspended and rely on
  // the server's account checks (documented limitation).
  coordination = { markerWritten: mark(), webLocks: Boolean(lockManager()) };
  const heartbeat = setInterval(mark, TRANSITION_HEARTBEAT_MS);
  notify();
  let ended = false;
  return {
    id,
    end(outcome) {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      state.transition = null;
      const label = typeof outcome === 'string' ? outcome : 'switched';
      writeKey(TRANSITION_STORAGE_KEY, { kind: 'ended', tx: id, tab: tabId, at: Date.now(), outcome: label } satisfies TransitionMarker);
      if (outcome === 'resumed' || outcome === 'resumed-verified') {
        state.gen += 1;
        notify();
      } else if (outcome === 'signed-out') {
        bumpEpoch(null);
        writeKey(ANNOUNCE_STORAGE_KEY, { account: null, tab: tabId, at: Date.now() });
      } else if (outcome === 'unknown') {
        bumpEpoch(undefined);
      } else {
        bumpEpoch(outcome.switchedTo);
        writeKey(ANNOUNCE_STORAGE_KEY, { account: outcome.switchedTo, tab: tabId, at: Date.now() });
      }
    },
  };
}

/** Test-only: reset module state between scenarios (simulates a fresh tab). */
export function __resetAccountSessionForTests(newTabId?: string) {
  state.epoch = 0;
  state.gen = 0;
  state.account = undefined;
  state.transition = null;
  listeners.clear();
  inFlight.clear();
  controllers.clear();
  storageListenerInstalled = false;
  sessionReqSeq = 0;
  latestSession = null;
  ensureInFlight = null;
  upgradeRequired = false;
  if (newTabId) tabId = newTabId;
}
/** Test-only: deliver a cross-tab storage event. */
export function __deliverStorageEventForTests(e: { key: string | null; newValue: string | null }) {
  onStorage(e);
}
