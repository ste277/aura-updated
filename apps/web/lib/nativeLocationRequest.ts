/**
 * AURA-MOBILE-01-M2-D -- native location request lifecycle.
 *
 * @capacitor/geolocation 6.1.1 on Android issues a single
 * FusedLocationProviderClient.getCurrentLocation(priority, null) call with
 * NO cancellation token, and ignores the `timeout` option. A native request
 * therefore always runs until the provider answers (observed ~30 s when no
 * fix is available, M2-C/F2). This module:
 *
 *  - keeps ONE native request in flight at a time, shared across every
 *    LocationPicker instance (module scope), so retries and close/reopen
 *    join the running request instead of starting another one;
 *  - tracks a request until its underlying promise settles -- an
 *    application timeout never "cancels" it;
 *  - bounds the pathological case of a request that never settles: after
 *    NATIVE_LOCATION_STALE_MS a new request may start (at most one new
 *    native request per stale window), so a dead request cannot block
 *    location forever;
 *  - provides an application-level timeout whose timer is always cleared
 *    when the request settles or the caller cancels.
 */
import { LocationTimeoutError } from './locationErrors';

/** Native (Capacitor) app-level timeout. Matches the provider's own ~30 s
 * window observed on the Samsung SM-A066B, so a slow-but-valid fix is no
 * longer discarded at 10 s. */
export const NATIVE_LOCATION_TIMEOUT_MS = 30_000;
/** After this long the button shows "Still finding your location...". */
export const NATIVE_LOCATION_PROGRESS_MS = 10_000;
/** A still-unsettled native request older than this no longer blocks a new
 * one (bounded accumulation: <= 1 new native request per window). */
export const NATIVE_LOCATION_STALE_MS = 60_000;
/** Web (navigator.geolocation) timeout -- unchanged from before M2-D. */
export const WEB_LOCATION_TIMEOUT_MS = 10_000;

interface InFlightEntry {
  readonly promise: Promise<unknown>;
  readonly startedAt: number;
}

let current: InFlightEntry | null = null;
const unsettled = new Set<Promise<unknown>>();

/**
 * Returns the in-flight native request if one is running (and not stale),
 * otherwise starts a new one via `start`. `joined` is true when the caller
 * attached to an existing request rather than starting one.
 */
export function acquireNativeLocation<T>(start: () => Promise<T>): { promise: Promise<T>; joined: boolean } {
  const now = Date.now();
  if (current && now - current.startedAt < NATIVE_LOCATION_STALE_MS) {
    return { promise: current.promise as Promise<T>, joined: true };
  }
  let promise: Promise<T>;
  try {
    promise = start();
  } catch (err) {
    promise = Promise.reject(err);
  }
  const entry: InFlightEntry = { promise, startedAt: now };
  current = entry;
  unsettled.add(promise);
  const settle = () => {
    unsettled.delete(promise);
    if (current === entry) current = null;
  };
  promise.then(settle, settle);
  return { promise, joined: false };
}

/** Number of native requests started here whose promise has not settled
 * yet (diagnostics/tests; includes stale ones that no longer block). */
export function unsettledNativeLocationRequests(): number {
  return unsettled.size;
}

/** True while a (non-stale) native request is in flight. */
export function isNativeLocationInFlight(): boolean {
  return current !== null && Date.now() - current.startedAt < NATIVE_LOCATION_STALE_MS;
}

/** Test-only reset of module state. */
export function __resetNativeLocationForTests(): void {
  current = null;
  unsettled.clear();
}

/**
 * Waits for `promise` for at most `ms`. Rejects with LocationTimeoutError on
 * timeout (the underlying promise keeps running). The timer is cleared as
 * soon as the promise settles, and `cancel()` clears it and detaches the
 * waiter (used on unmount / when a newer UI operation supersedes this one).
 */
export function waitWithTimeout<T>(promise: Promise<T>, ms: number): { promise: Promise<T>; cancel: () => void } {
  let timer: number | null = null;
  let done = false;
  const clear = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const wrapped = new Promise<T>((resolve, reject) => {
    timer = window.setTimeout(() => {
      timer = null;
      if (done) return;
      done = true;
      reject(new LocationTimeoutError());
    }, ms);
    promise.then(
      (value) => {
        clear();
        if (done) return;
        done = true;
        resolve(value);
      },
      (err) => {
        clear();
        if (done) return;
        done = true;
        reject(err);
      }
    );
  });
  return {
    promise: wrapped,
    cancel: () => {
      done = true;
      clear();
    },
  };
}
