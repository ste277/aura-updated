import { decideBackAction } from '../apps/web/lib/androidBackNavigation';

let allPassed = true;
function check(label: string, cond: boolean) {
  if (!cond) allPassed = false;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`);
}

// --- Authentication boundary: unauthenticated always exits, regardless of
// modal/history state (there is no in-app "previous screen" at the login
// screen -- default Capacitor/Android exit behavior is correct there). ---
{
  const action = decideBackAction({ isAuthenticated: false, anyModalOpen: false, historyStack: [] });
  check('unauthenticated, no modal, empty stack -> exit', action.kind === 'exit');
}
{
  const action = decideBackAction({ isAuthenticated: false, anyModalOpen: true, historyStack: ['home'] });
  check('unauthenticated takes priority even with a modal open and history present -> exit (not close-modal, not navigate)', action.kind === 'exit');
}

// --- Modal priority: an open modal is dismissed before the view-history
// stack is ever consulted. ---
{
  const action = decideBackAction({ isAuthenticated: true, anyModalOpen: true, historyStack: ['home'] });
  check('authenticated, modal open, non-empty stack -> close-modal (modal wins)', action.kind === 'close-modal');
}
{
  const action = decideBackAction({ isAuthenticated: true, anyModalOpen: true, historyStack: [] });
  check('authenticated, modal open, empty stack -> still close-modal (modal still wins)', action.kind === 'close-modal');
}

// --- View-history stack: pops the most recent entry, not the oldest. ---
{
  const action = decideBackAction({ isAuthenticated: true, anyModalOpen: false, historyStack: ['home', 'explore', 'you'] });
  check(
    'authenticated, no modal, 3-deep stack -> navigate to the MOST RECENT entry ("you"), not the oldest ("home")',
    action.kind === 'navigate' && action.tab === 'you'
  );
}
{
  const action = decideBackAction({ isAuthenticated: true, anyModalOpen: false, historyStack: ['home'] });
  check('authenticated, no modal, 1-deep stack -> navigate to that single entry', action.kind === 'navigate' && action.tab === 'home');
}

// --- Root-level behavior: authenticated, no modal, empty stack -> exit
// (deliberately no double-back-to-exit, per the reviewed plan). ---
{
  const action = decideBackAction({ isAuthenticated: true, anyModalOpen: false, historyStack: [] });
  check('authenticated, no modal, empty stack (root) -> exit, not navigate, not close-modal', action.kind === 'exit');
}

console.log(allPassed ? '\nAll androidBackNavigation tests passed.' : '\nSome androidBackNavigation tests FAILED.');
process.exit(allPassed ? 0 : 1);
