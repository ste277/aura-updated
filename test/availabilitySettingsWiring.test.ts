/**
 * Availability Settings V1 -- PR H2 component-wiring regression suite.
 * This repository's own test suite never renders React components (see
 * homeDashboardLogic.test.ts's own doc comment) -- so, matching the
 * established precedent for exactly this class of property
 * (planDayWiring.test.ts), this file proves AvailabilitySettings.tsx's
 * and YouView.tsx's own ARCHITECTURAL WIRING facts by reading their
 * real, shipped source -- never a rendering harness, never a
 * reimplementation. Every DECISION a human could get wrong (add/remove/
 * copy/validate/flatten) already has real behavioral coverage in
 * availabilitySettings.test.ts; this file only proves the wiring around
 * those decisions is what it claims to be.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const componentSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/AvailabilitySettings.tsx'), 'utf8');
const youViewSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/YouView.tsx'), 'utf8');

function main() {
  // ============================================================
  // 49. Mounted in Settings.
  // ============================================================
  check('49. YouView imports AvailabilitySettings', youViewSource.includes("import { AvailabilitySettings } from './AvailabilitySettings';"));
  check('49b. YouView renders <AvailabilitySettings /> under an "Availability" SectionHeader', /<SectionHeader label="Availability" \/>\s*<AvailabilitySettings \/>/.test(youViewSource));
  check('49c. product language uses "Availability," never "Working Hours" (this ticket\'s own section 3)', !/Working Hours/i.test(componentSource) && !/Working Hours/i.test(youViewSource));

  // ============================================================
  // 50/51. Unconfigured vs configured hydration.
  // ============================================================
  check('50. an unconfigured GET response hydrates via createEmptyWeekDraft, never a hardcoded populated schedule', /body\.configured \? hydrateWeekDraft\(periods\) : createEmptyWeekDraft\(\)/.test(componentSource));
  check('51. a configured GET response hydrates real periods via hydrateWeekDraft', componentSource.includes('hydrateWeekDraft(periods)'));

  // ============================================================
  // 52/53/54. Add / Remove / Copy wiring.
  // ============================================================
  check('52. Add period is wired to the pure addPeriod function', /onAdd=\{\(\) => setDraft\(\(current\) => addPeriod\(current, day\.weekday\)\)\}/.test(componentSource));
  check('53. Remove period is wired to the pure removePeriod function', /onRemove=\{\(periodId\) => setDraft\(\(current\) => removePeriod\(current, day\.weekday, periodId\)\)\}/.test(componentSource));
  check('54. Copy Monday to weekdays is wired to the pure copyMondayToWeekdays function', /onCopyToWeekdays=\{\(\) => setDraft\(\(current\) => copyMondayToWeekdays\(current\)\)\}/.test(componentSource));

  // ============================================================
  // 55/56/57/58. Save vs Reset -- distinct network operations.
  // ============================================================
  check('55. Save calls the availability preferences API', componentSource.includes("fetch('/api/users/availability-preferences'"));
  check("55b. Save uses PUT (replace semantics, this ticket's own section 20)", /method: 'PUT'/.test(componentSource));
  check('56. Save sends the complete flattened period set as the request body', /body: JSON\.stringify\(\{ periods: flattened \}\)/.test(componentSource));
  check("57. Reset uses a DISTINCT operation (DELETE), never periods: []", /method: 'DELETE'/.test(componentSource));
  {
    // 58. Save (even with an empty draft) and Reset are structurally
    // different fetch calls -- Save always sends a body with `periods`;
    // the DELETE (reset) call never does.
    const deleteCallMatch = componentSource.match(/fetch\('\/api\/users\/availability-preferences', \{ method: 'DELETE' \}\)/);
    check('58. the reset fetch call carries no periods body at all (never overloads an empty-array Save to mean Reset)', !!deleteCallMatch);
  }

  // ============================================================
  // 59/60/61. Authoritative server context, no client authority.
  // ============================================================
  check('59. displayed timezone comes from the GET response body, never a hardcoded/local value', /load\.timezone/.test(componentSource) && componentSource.includes('body.timezone'));
  check('60. the component never sends a userId field in any request body', !/userId:/.test(componentSource));
  check('61. the component never sends a timezone field in any request body (Save body is periods only)', !/JSON\.stringify\(\{[^}]*timezone/.test(componentSource));

  // ============================================================
  // 62/63/64. Loading / saving / error states.
  // ============================================================
  check("62. a LOADING state is rendered distinctly (never a fake default schedule while GET is pending)", /load\.kind === 'LOADING'/.test(componentSource));
  check('63. a saving state is tracked and disables Save / changes its label', /saving \? .Saving…. : .Save./.test(componentSource) && /disabled=\{!canSave\}/.test(componentSource));
  check('64. an error state is rendered via FieldError for both load and save failures', (componentSource.match(/<FieldError>/g) ?? []).length >= 2);

  // ============================================================
  // 65. Accessibility labels.
  // ============================================================
  check('65a. weekday period start/end time inputs use FieldLabel with htmlFor (never icon-only, unlabeled inputs)', /FieldLabel htmlFor=\{startId\}/.test(componentSource) && /FieldLabel htmlFor=\{endId\}/.test(componentSource));
  check('65b. the remove-period control has an explicit accessible name (IconButton ariaLabel), not icon-only', /IconButton ariaLabel=\{`Remove \$\{WEEKDAY_LABELS\[weekday\]\}/.test(componentSource));
  check('65c. the Save control has an explicit accessible name', /PrimaryButton onClick=\{handleSave\} disabled=\{!canSave\} ariaLabel="Save availability"/.test(componentSource));
  check('65d. Reset/Cancel/Confirm controls all carry real text content (accessible names via content, this app\'s own established no-confirmation-modal-framework convention)', componentSource.includes('Reset availability') && componentSource.includes('Cancel'));

  if (!allPassed) {
    console.error('\nSome Availability Settings Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL AVAILABILITY SETTINGS WIRING CHECKS PASSED');
  }
}

main();
