/**
 * AURA-ANDROID-REL-04 (R16 test stabilization) -- runs a jsdom real-Home section on a DETERMINISTIC instant, as the
 * production Chromium suites do with page.clock.setFixedTime: `Date` (global and jsdom window) starts at `instantMs`
 * and keeps ADVANCING in real time, so timers, awaits and timeout assertions stay meaningful. `restore()` puts the
 * original `Date` back. Which Good Right Now card Home offers depends on the time of day; without this, a real-Home
 * section can find no "Start now" at some hours (CI 46108171358).
 */
export const HOME_SECTION_INSTANT = Date.parse('2026-11-27T06:35:00.000Z'); // 12:05 IST, the production Chromium instant

export function pinClock(instantMs: number = HOME_SECTION_INSTANT) {
  const RealDate = Date;
  const offset = instantMs - RealDate.now();
  const now = () => RealDate.now() + offset;
  class PinnedDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(now()); else super(...(a as [any])); }
    static now() { return now(); }
  }
  const g = globalThis as any;
  const w = typeof window !== 'undefined' ? (window as any) : null;
  const prevG = g.Date, prevW = w ? w.Date : undefined;
  g.Date = PinnedDate;
  if (w) w.Date = PinnedDate;
  return { now, restore() { g.Date = prevG; if (w) w.Date = prevW; } };
}
