/**
 * AURA-MOBILE-01-M2-B/AND-02 -- the pure back-button decision logic, kept
 * separate from lib/useAndroidBackButton.ts's React/Capacitor wiring so it's
 * testable without mocking either. Priority order: a logged-out session has
 * no in-app "previous screen" to return to (exit is correct there); an open
 * modal takes priority over the view-history stack (dismiss it first); a
 * non-empty stack pops one level; an empty stack at the authenticated root
 * exits the app.
 */
export type BackAction<T> = { kind: 'exit' } | { kind: 'close-modal' } | { kind: 'navigate'; tab: T };

export function decideBackAction<T>(params: {
  isAuthenticated: boolean;
  anyModalOpen: boolean;
  historyStack: readonly T[];
}): BackAction<T> {
  if (!params.isAuthenticated) return { kind: 'exit' };
  if (params.anyModalOpen) return { kind: 'close-modal' };
  if (params.historyStack.length > 0) {
    return { kind: 'navigate', tab: params.historyStack[params.historyStack.length - 1] };
  }
  return { kind: 'exit' };
}
