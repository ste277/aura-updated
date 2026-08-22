/** Strips the wrapper words around a countdown string so it's a bare
 * duration safe to embed mid-sentence (e.g. "You have about ${timeLeft}
 * before..."). Home's "remainingText" comes from two different sources
 * depending on state: currentWindow.timeRemaining formats as "3h 9m left"
 * (HomeDashboard.tsx), while nextShift.startsIn formats as "In 3h 9m"
 * (scoreEngine.ts) -- without stripping both wrappers, the "In " prefix
 * survived into "You have about In 3h 9m before...". */
export function stripCountdownWrapper(remainingText: string): string {
  return remainingText.replace(/^in\s+/i, '').replace(/\s*left$/i, '').trim();
}
