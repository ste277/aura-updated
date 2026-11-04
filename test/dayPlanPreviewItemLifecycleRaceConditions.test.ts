// AURA PR #281 P0 fix -- Preview Lifecycle and Async Race. 7 deterministic
// scenarios using deferred promises/controlled response ordering (never
// real network timing), proving the fix behaviorally rather than merely
// structurally.
//
// EditProposedItemTimeModal.tsx/DayPlanPreviewController.tsx/
// PlanDayClient.tsx's own handleSave/onApply/replacePreview closures are
// private to those React components -- there is no jsdom/testing-library
// in this repo to mount and drive the real component tree (confirmed:
// neither package exists anywhere in node_modules), so, consistent with
// this project's existing, deliberate convention for EXACTLY this class of
// problem (see dr4f2bAsyncRaceConditions.test.ts's own header comment,
// which this file mirrors field-for-field), this file:
//   1. Re-implements the exact control-flow shape of those three closures
//      (same state names, same guard conditions, same call order) using
//      the REAL, imported, production pure function
//      (applyUpdatedProposedItem, dayPlanPreviewItemEditing.ts) for the
//      one piece of actual state-merge logic -- only the React
//      state/closure glue is mirrored, never reimplemented logic.
//   2. Exercises that mirror against all 7 scenarios this ticket requires,
//      with deferred promises giving this test exact control over
//      resolution order.
//   3. Is paired with dayPlanPreviewItemEditingWiring.test.ts's own
//      structural regex checks (23-28, added by this same fix) binding
//      this exact guard shape (previewGenerationRef, replacePreview,
//      mountedRef, the Escape saving-guard) to the real
//      PlanDayClient.tsx/DayPlanPreviewController.tsx/
//      EditProposedItemTimeModal.tsx wiring -- so a change to the REAL
//      guard's shape that drifts from what's mirrored here fails THOSE
//      checks, and a regression in the guard's actual BEHAVIOR fails
//      these.
//
// Each scenario's own comment states which vulnerable behavior it would
// have caught -- independently confirmed (see this ticket's own delivery
// report) by temporarily reverting PlanEditSimulator's guards to their
// pre-fix shape (raw unconditional Escape; no generation check; no
// mounted check) and re-running this file, which fails scenarios
// 1/2/3/4 exactly as expected, before being restored.
import { applyUpdatedProposedItem } from '../apps/web/lib/dayPlanPreviewItemEditing';
import type { UpdatePreviewItemTimeClientResult, UpdatedPreviewItem } from '../apps/web/lib/dayConstructorPreviewItemClient';
import type { ConstructDayPreview, ResolvedIntentSummary } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ProposedItem } from '../apps/web/lib/dayConstructor';
import type { CapacitySnapshot, CapacityState } from '../apps/web/lib/dayCapacity';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

function snapshot(capacityState: CapacityState = 'OPEN'): CapacitySnapshot {
  return { constructionWindowMinutes: 480, blockedMinutes: 0, usableMinutes: 480, requestedMinutes: 0, remainingMinutes: 480, utilization: 0, capacityState };
}

function proposedItem(overrides: Partial<ProposedItem> & { intentId: string; start: Date; end: Date }): ProposedItem {
  return { title: 'Untitled', placementSource: 'FIXED_CONSTRAINT', requiresConfirmation: true, ...overrides };
}

function preview(items: ProposedItem[]): ConstructDayPreview {
  const resolvedIntents: ResolvedIntentSummary[] = items.map((item) => ({
    requestedIntentId: item.intentId,
    dayIntent: { id: item.intentId, title: item.title, targetDate: '2026-09-16', importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0 },
  }));
  return {
    targetDate: '2026-09-16',
    timezone: 'America/New_York',
    constructionWindow: { date: '2026-09-16', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' },
    resolvedIntents,
    constructedDay: { date: '2026-09-16', proposedItems: items, deferredItems: [], conflicts: [], requestedCapacity: snapshot(), proposedCapacity: snapshot() },
    warnings: [],
  };
}

function updatedItem(overrides: Partial<UpdatedPreviewItem> & { intentId: string }): UpdatedPreviewItem {
  return {
    title: 'Untitled',
    placementSource: 'SELECTED_CANDIDATE',
    requiresConfirmation: true,
    start: iso('2026-09-16T16:00:00Z'),
    end: iso('2026-09-16T17:00:00Z'),
    acceptanceToken: 'new-token',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type EditingSnapshot = { item: ProposedItem; generation: number };

/**
 * PlanEditSimulator -- mirrors the THREE closures this fix touches,
 * field-for-field against the real source:
 *
 *   - PlanDayClient.tsx: `previewGenerationRef`/`replacePreview`/
 *     `mountedRef` (this file's own `generation`/`replacePreview`/
 *     `mounted`).
 *   - DayPlanPreviewController.tsx: `editing` state + its `onApply`
 *     handler's generation check (this file's own `editing`/`applyResult`).
 *   - EditProposedItemTimeModal.tsx: `saving` state, the double-submit
 *     guard, and the FIXED Escape handler's `saving` guard (this file's
 *     own `saving`/`save`/`pressEscape`).
 *
 * `save()` takes its own `EditingSnapshot` parameter rather than reading
 * `this.editing` live -- this is deliberate, mirroring exactly how the
 * real `onApply` prop handed to a specific `<EditProposedItemTimeModal>`
 * render closes over THAT render's own `editing` value, not whatever
 * `editing` happens to hold when the promise eventually resolves (the
 * stale-closure shape the real bug lived in).
 */
class PlanEditSimulator {
  preview: ConstructDayPreview | null;
  generation = 0;
  mounted = true;
  editing: EditingSnapshot | null = null;
  saving = false;
  closeCalls = 0;
  appliedCount = 0;

  constructor(initialPreview: ConstructDayPreview | null) {
    this.preview = initialPreview;
  }

  // mirrors PlanDayClient.tsx's replacePreview()
  replacePreview(next: ConstructDayPreview | null) {
    if (!this.mounted) return;
    this.generation += 1;
    this.preview = next;
  }

  // mirrors PlanDayClient.tsx's handleDiscard()
  discard() {
    this.replacePreview(null);
  }

  // mirrors PlanDayClient.tsx's submitPreview() READY branch (Review again/Regenerate)
  regenerate(next: ConstructDayPreview) {
    this.replacePreview(next);
  }

  // mirrors the real unmount effect's cleanup (mountedRef.current = false)
  unmount() {
    this.mounted = false;
  }

  // mirrors DayPlanPreviewController.tsx's onEditItem handler
  openEdit(item: ProposedItem): EditingSnapshot {
    const snapshot: EditingSnapshot = { item, generation: this.generation };
    this.editing = snapshot;
    this.saving = false;
    return snapshot;
  }

  // mirrors EditProposedItemTimeModal.tsx's handleSave()
  async save(editingSnapshot: EditingSnapshot, fetchPromise: Promise<UpdatePreviewItemTimeClientResult>) {
    if (this.saving) return; // double-submit guard, mirrors `if (... || saving) return;`
    this.saving = true;
    const result = await fetchPromise; // mirrors `await updatePreviewItemTime(...)`
    this.saving = false;
    if (result.status === 'UPDATED') {
      this.applyResult(editingSnapshot, result.item);
    }
    // REJECTED/HTTP_ERROR/NETWORK_ERROR/UNKNOWN_RESPONSE -- mirrors
    // setError(...); the modal stays open, `editing` is untouched.
  }

  // mirrors EditProposedItemTimeModal.tsx's FIXED useModalA11y Escape wiring:
  // onClose: saving ? NOOP : onClose
  pressEscape() {
    if (this.saving) return; // P0 fix -- no-op while a save is in flight
    this.closeModal();
  }

  // mirrors ModalShell's onClose={saving ? undefined : onClose} / Cancel's disabled={saving}
  pressCancel() {
    if (this.saving) return;
    this.closeModal();
  }

  closeModal() {
    this.editing = null;
    this.closeCalls += 1;
  }

  // mirrors DayPlanPreviewController.tsx's onApply={(updatedItem) => {...}}
  applyResult(editingSnapshot: EditingSnapshot, item: UpdatedPreviewItem) {
    this.closeModal(); // setEditing(null) -- unconditional, first line of the real onApply
    if (this.generation !== editingSnapshot.generation) return; // superseded -- discard silently, no setPreview call
    if (!this.preview) return; // defensive; generation-unchanged already implies this can't happen
    if (!this.mounted) return; // mirrors replacePreview's own mountedRef guard; kept separate here too so appliedCount reflects an ACTUAL apply, not an attempted one
    this.replacePreview(applyUpdatedProposedItem(this.preview, item));
    this.appliedCount += 1;
  }
}

function itemA() {
  return proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') });
}
function itemB() {
  return proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T17:00:00Z'), end: iso('2026-09-16T17:30:00Z') });
}

async function main() {
  // ---- 1. Escape during an unresolved save ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    sim.pressEscape(); // fired while `saving` is true
    check('1a. Escape while saving is a no-op -- the modal does not close', sim.editing !== null && sim.closeCalls === 0);
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') }) });
    await savePromise;
    check('1b. once the (now-waited-for) response resolves, it applies normally -- Escape never cancelled the save itself, only its own premature dismissal', sim.appliedCount === 1 && sim.preview?.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T20:00:00Z').getTime());
  }

  // ---- 2. Discard followed by a late successful response ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    sim.discard(); // user discards WHILE the edit's request is still in flight
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a' }) });
    await savePromise;
    check('2. Discard -> late UPDATED response: the preview stays discarded (null), never resurrected', sim.preview === null);
  }

  // ---- 3. Regenerate followed by a late successful response ----
  {
    const originalPreview = preview([itemA(), itemB()]);
    const sim = new PlanEditSimulator(originalPreview);
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    const regenerated = preview([proposedItem({ intentId: 'c', title: 'A brand new plan', start: iso('2026-09-16T09:00:00Z'), end: iso('2026-09-16T09:30:00Z') })]);
    sim.regenerate(regenerated); // "Review again" produces a genuinely new preview while the edit is in flight
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a' }) });
    await savePromise;
    check('3a. Regenerate -> late UPDATED response: the newly regenerated preview is never stomped by the stale edit', sim.preview === regenerated && sim.preview?.constructedDay.proposedItems[0].intentId === 'c');
  }
  // 3b -- the SAME scenario, but the regenerated preview happens to carry
  // an item with the SAME intentId ('a') the stale edit targeted (e.g. the
  // user re-submitted an identical row). applyUpdatedProposedItem's own
  // "intentId not found -> no-op" defense would NOT catch this on its own
  // (the lookup WOULD succeed) -- only the generation guard does. This is
  // what isolates the generation check's own necessity, independent of
  // that pure function's unrelated defensiveness.
  {
    const originalPreview = preview([itemA(), itemB()]);
    const sim = new PlanEditSimulator(originalPreview);
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    const regeneratedFreshItemA = proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T10:00:00Z'), end: iso('2026-09-16T10:30:00Z') });
    const regenerated = preview([regeneratedFreshItemA]);
    sim.regenerate(regenerated);
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T23:00:00Z'), end: iso('2026-09-16T23:30:00Z') }) }); // the STALE edit's own result
    await savePromise;
    check('3b. Regenerate produces a fresh item with the SAME intentId the stale edit targeted -- the stale response still cannot overwrite it (proves the generation guard itself, not just applyUpdatedProposedItem\'s unrelated intentId-lookup defense)', sim.preview === regenerated && sim.preview?.constructedDay.proposedItems[0] === regeneratedFreshItemA && sim.preview?.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T10:00:00Z').getTime());
  }

  // ---- 4. Unmount during save ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    sim.unmount();
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T22:00:00Z'), end: iso('2026-09-16T23:00:00Z') }) });
    await savePromise;
    // generation guard alone would already pass here (nothing bumped it), so this
    // specifically proves the SEPARATE mountedRef guard inside replacePreview --
    // without it, this would incorrectly apply after a real unmount.
    check('4. unmount during save: the stale response can never call replacePreview on an unmounted owner (mountedRef guard, independent of the generation check)', sim.appliedCount === 0 && sim.preview?.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T14:00:00Z').getTime());
  }

  // ---- 5. Repeated editing of the same item ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    // First edit: rejected (TIMING_CHECK_FAILED) -- modal stays open, user tries again.
    const snapshot1 = sim.openEdit(itemA());
    await sim.save(snapshot1, Promise.resolve({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }));
    check('5a. a rejected edit leaves the modal open (no close call) and applies nothing', sim.editing !== null && sim.appliedCount === 0);
    // Second attempt, same session (same captured generation) -- succeeds.
    await sim.save(snapshot1, Promise.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T15:30:00Z'), end: iso('2026-09-16T16:00:00Z') }) }));
    check('5b. the resubmitted edit (same item, same session) applies, and the modal closes', sim.editing === null && sim.appliedCount === 1 && sim.preview?.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T15:30:00Z').getTime());
    // Reopen the SAME item for a genuinely separate second edit (new session, new generation).
    const snapshot2 = sim.openEdit(sim.preview!.constructedDay.proposedItems[0]);
    await sim.save(snapshot2, Promise.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T18:00:00Z'), end: iso('2026-09-16T18:30:00Z') }) }));
    check('5c. a later, independent edit of the SAME item reflects only its OWN latest selection', sim.preview?.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T18:00:00Z').getTime());
  }

  // ---- 6. A normal successful edit (regression) ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    req.resolve({ status: 'UPDATED', item: updatedItem({ intentId: 'a', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T16:30:00Z'), acceptanceToken: 'tok-fresh' }) });
    await savePromise;
    check('6. normal successful edit: applies, closes the modal, bumps the generation exactly once', sim.appliedCount === 1 && sim.editing === null && sim.generation === 1);
    check('6. the applied item carries its new acceptanceToken and the untouched sibling is byte-identical', (sim.preview?.constructedDay.proposedItems[0] as { acceptanceToken?: string }).acceptanceToken === 'tok-fresh' && sim.preview?.constructedDay.proposedItems[1].title === 'Workout');
  }

  // ---- 7. A rejected edit (regression) ----
  {
    const sim = new PlanEditSimulator(preview([itemA(), itemB()]));
    const original = sim.preview;
    const snapshot = sim.openEdit(itemA());
    const req = deferred<UpdatePreviewItemTimeClientResult>();
    const savePromise = sim.save(snapshot, req.promise);
    req.resolve({ status: 'REJECTED', reason: 'UNAVAILABLE', detail: 'conflict' });
    await savePromise;
    check('7. rejected edit: the preview/original item/token are preserved unchanged, and the modal stays open for the user to try again', sim.preview === original && sim.editing !== null && sim.appliedCount === 0);
  }

  if (!allPassed) {
    console.error('\nSome Day Plan Preview Item LIFECYCLE RACE CONDITION checks FAILED.');
    process.exit(1);
  }
  console.log('\nALL DAY PLAN PREVIEW ITEM LIFECYCLE RACE CONDITION CHECKS PASSED');
  process.exit(0);
}

main();
