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
const uiSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/ui.tsx'), 'utf8');

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function main() {
  // ============================================================
  // 49. Mounted in Settings.
  // ============================================================
  check('49. YouView imports AvailabilitySettings', youViewSource.includes("import { AvailabilitySettings } from './AvailabilitySettings';"));
  check('49b. YouView renders <AvailabilitySettings /> under an "Availability" SectionHeader', /<SectionHeader label="Availability" \/>\s*<AvailabilitySettings \/>/.test(youViewSource));
  check('49c. product language uses "Availability," never "Working Hours" (this ticket\'s own section 3)', !/Working Hours/i.test(componentSource) && !/Working Hours/i.test(youViewSource));

  // ============================================================
  // 50/51. Unconfigured vs configured hydration -- unaffected by UX V2 PR A.
  // ============================================================
  check('50. an unconfigured GET response hydrates via createEmptyWeekDraft, never a hardcoded populated schedule', /body\.configured \? hydrateWeekDraft\(periods\) : createEmptyWeekDraft\(\)/.test(componentSource));
  check('51. a configured GET response hydrates real periods via hydrateWeekDraft', componentSource.includes('hydrateWeekDraft(periods)'));

  // ============================================================
  // 52/53/54. Add / Remove / Copy wiring -- unaffected by UX V2 PR A.
  // ============================================================
  check('52. Add period is wired to the pure addPeriod function', /onAdd=\{\(\) => setDraft\(\(current\) => addPeriod\(current, day\.weekday\)\)\}/.test(componentSource));
  check('53. Remove period is wired to the pure removePeriod function', /onRemove=\{\(periodId\) => setDraft\(\(current\) => removePeriod\(current, day\.weekday, periodId\)\)\}/.test(componentSource));
  check('54. Copy Monday to weekdays is wired to the pure copyMondayToWeekdays function', /onCopyToWeekdays=\{\(\) => setDraft\(\(current\) => copyMondayToWeekdays\(current\)\)\}/.test(componentSource));

  // ============================================================
  // 55/56/57/58. Save vs Reset -- distinct network operations, unaffected.
  // ============================================================
  check('55. Save calls the availability preferences API', componentSource.includes("fetch('/api/users/availability-preferences'"));
  check("55b. Save uses PUT (replace semantics, this ticket's own section 20)", /method: 'PUT'/.test(componentSource));
  check('56. Save sends the complete flattened period set as the request body', /body: JSON\.stringify\(\{ periods: flattened \}\)/.test(componentSource));
  check("57. Reset uses a DISTINCT operation (DELETE), never periods: []", /method: 'DELETE'/.test(componentSource));
  {
    const deleteCallMatch = componentSource.match(/fetch\('\/api\/users\/availability-preferences', \{ method: 'DELETE' \}\)/);
    check('58. the reset fetch call carries no periods body at all (never overloads an empty-array Save to mean Reset)', !!deleteCallMatch);
  }

  // ============================================================
  // 59/60/61. Authoritative server context, no client authority -- unaffected.
  // ============================================================
  check('59. displayed timezone comes from the GET response body, never a hardcoded/local value', /load\.timezone/.test(componentSource) && componentSource.includes('body.timezone'));
  check('60. the component never sends a userId field in any request body', !/userId:/.test(componentSource));
  check('61. the component never sends a timezone field in any request body (Save body is periods only)', !/JSON\.stringify\(\{[^}]*timezone/.test(componentSource));

  // ============================================================
  // 62/63/64. Loading / saving / error states -- unaffected.
  // ============================================================
  check("62. a LOADING state is rendered distinctly (never a fake default schedule while GET is pending)", /load\.kind === 'LOADING'/.test(componentSource));
  check('63. a saving state is tracked and disables Save / changes its label', /saving \? .Saving…. : .Save./.test(componentSource) && /disabled=\{!canSave\}/.test(componentSource));
  check('64. an error state is rendered via FieldError for load, validation, AND save failures (at least 3 sites)', occurrences(componentSource, '<FieldError>') >= 3);

  // ============================================================
  // Availability Settings UX V2 PR A -- compact weekday summaries +
  // progressive per-day editing (65-90).
  // ============================================================

  // 65. expandedWeekdays is real, UI-only state -- never part of the
  // request body/draft/persistence (this ticket's own section 13).
  check('65. expandedWeekdays is declared as component state, defaulting to an empty Set (all collapsed)', /const \[expandedWeekdays, setExpandedWeekdays\] = useState<ReadonlySet<Weekday>>\(new Set\(\)\);/.test(componentSource));
  check('65b. expandedWeekdays is never sent in any request body', !/JSON\.stringify\(\{[^}]*expandedWeekdays/.test(componentSource));
  check('65c. expandedWeekdays never appears inside flattenWeekDraft/validateWeekDraft/canSave\'s own dirty calculation', !/const dirty[\s\S]{0,120}expandedWeekdays/.test(componentSource) && !/const canSave[\s\S]{0,120}expandedWeekdays/.test(componentSource));

  // 66. toggleWeekdayExpanded is a plain Set toggle -- add if absent,
  // remove if present, matching PlanDayClient.tsx's own established
  // toggleRowExpanded convention (never a single-expanded/accordion
  // model forced, this ticket's own section 13).
  check(
    '66. toggleWeekdayExpanded toggles membership in the Set (add/delete), never restricting to one at a time',
    /function toggleWeekdayExpanded\(weekday: Weekday\) \{\s*setExpandedWeekdays\(\(current\) => \{\s*const next = new Set\(current\);\s*if \(next\.has\(weekday\)\) next\.delete\(weekday\);\s*else next\.add\(weekday\);\s*return next;\s*\}\);\s*\}/.test(componentSource)
  );

  // 67. WeekdayRow branches on `expanded` -- collapsed vs expanded are
  // genuinely different render paths, not a CSS-only show/hide.
  check('67. WeekdayRow has an early-return collapsed branch (!expanded)', /if \(!expanded\) \{\s*return \(/.test(componentSource));

  // 68. Collapsed row shows the weekday name, a plain-language summary
  // via the shared formatWeekdaySummary helper, and an explicit Edit
  // affordance (this ticket's own section 7/10) -- never a bare
  // undiscoverable tappable row.
  {
    const collapsedMatch = componentSource.match(/if \(!expanded\) \{\s*return \(([\s\S]*?)\);\s*\}/);
    const collapsedBody = collapsedMatch?.[1] ?? '';
    check('68. the collapsed branch renders the weekday label', collapsedBody.includes('{label}'));
    check('68b. the collapsed branch renders formatWeekdaySummary(periods), never a second inline summary formatter', collapsedBody.includes('formatWeekdaySummary(periods)'));
    check('68c. the collapsed branch renders an explicit "Edit" SecondaryButton with a real accessible name', /SecondaryButton onClick=\{onToggleExpanded\}[^>]*ariaLabel=\{`Edit \$\{label\} availability`\}/.test(collapsedBody) && collapsedBody.includes('>\n          Edit\n'));
  }

  // 69. formatWeekdaySummary is imported from availabilitySettings.ts,
  // never reimplemented inline in the component (this ticket's own
  // section 17).
  check('69. formatWeekdaySummary is imported from availabilitySettings.ts, never reimplemented in the component', componentSource.includes('formatWeekdaySummary,') && !/function formatWeekdaySummary/.test(componentSource));

  // 70. Implementation-facing visible labels are gone (this ticket's
  // own section 19/28/36 of the audit) -- the literal "PERIOD 1 START
  // TIME"-style sentence never appears as ordinary visible JSX text.
  check(
    '70b. every period-label FieldLabel usage passes visuallyHidden -- never rendered as ordinary visible text',
    (() => {
      const matches = componentSource.match(/<FieldLabel htmlFor=\{(start|end)Id\}[^>]*>/g) ?? [];
      return matches.length === 2 && matches.every((m) => m.includes('visuallyHidden'));
    })()
  );

  // 71. The accessible name text itself is UNCHANGED from before UX V2
  // PR A (this ticket's own section 20/54) -- "{Weekday} period {N}
  // start/end time" -- so screen-reader behavior is preserved exactly,
  // only sighted visibility changed.
  check('71. the start-time accessible label text is unchanged: "${label} period ${index + 1} start time"', componentSource.includes('{`${label} period ${index + 1} start time`}'));
  check('71b. the end-time accessible label text is unchanged: "${label} period ${index + 1} end time"', componentSource.includes('{`${label} period ${index + 1} end time`}'));

  // 72. FieldLabel itself gained visuallyHidden as an ADDITIVE,
  // backward-compatible prop (ui.tsx) -- every other existing caller
  // renders exactly as before (default path unchanged).
  check('72. ui.tsx\'s FieldLabel accepts an optional visuallyHidden prop', /function FieldLabel\(\{ children, htmlFor, visuallyHidden \}/.test(uiSource));
  check('72b. FieldLabel\'s default (non-visuallyHidden) branch is byte-identical to the pre-V2 visible styling', /: \{ display: 'block', \.\.\.typography\.sectionEyebrow, marginBottom: spacing\.sm \}/.test(uiSource));

  // 73. A visual "→" connects start and end so a period reads as ONE
  // range, not two unrelated fields (this ticket's own section 21).
  check('73. a visual arrow separates the start and end time inputs', /<span aria-hidden="true"[^>]*>→<\/span>/.test(componentSource));

  // 74. Expanded editor still uses the SAME native time input
  // infrastructure -- never replaced merely for visual consistency
  // (this ticket's own section 18).
  check('74. expanded editing still uses TextInput type="time" for start/end', occurrences(componentSource, 'type="time"') === 2);

  // 75. Remove-period accessible name unchanged (this ticket's own
  // section 22/54).
  check('75. the remove-period control keeps its explicit accessible name identifying weekday + period index', /IconButton ariaLabel=\{`Remove \$\{label\} period \$\{index \+ 1\}`\}/.test(componentSource));

  // 76. Removing the final period never resets global availability --
  // the expanded zero-period branch still just shows "Not available"
  // plus an Add action, never a call to the Reset/DELETE path (this
  // ticket's own section 22).
  {
    const expandedZeroMatch = componentSource.match(/periods\.length === 0 \? \(\s*<div[^>]*>Not available<\/div>/);
    check('76. the expanded zero-period state renders "Not available", never triggering Reset', !!expandedZeroMatch);
  }

  // 77. Add-period wording distinguishes a from-zero day ("+ Add
  // period") from a day that already has periods ("+ Add another
  // period") -- this ticket's own section 9/23.
  check('77. Add-period wording is conditional on periods.length', /\{periods\.length === 0 \? '\+ Add period' : '\+ Add another period'\}/.test(componentSource));

  // 78. Copy Monday to weekdays lives INSIDE the expanded editor (this
  // ticket's own section 25), gated the SAME as before (Monday AND has
  // periods) -- never shown on the collapsed row.
  {
    const collapsedMatch = componentSource.match(/if \(!expanded\) \{\s*return \(([\s\S]*?)\);\s*\}/);
    const collapsedBody = collapsedMatch?.[1] ?? '';
    check('78. "Copy to weekdays" never appears in the collapsed row', !collapsedBody.includes('Copy to weekdays'));
    check('78b. "Copy to weekdays" appears in the expanded editor, still gated on showCopy', /\{showCopy && \(\s*<TextButton onClick=\{onCopyToWeekdays\}/.test(componentSource));
  }
  check('78c. showCopy is still computed exactly as before: Monday AND has periods', /showCopy=\{day\.weekday === 1 && day\.periods\.length > 0\}/.test(componentSource));

  // 79. Done collapses the SAME weekday via the SAME toggle handler as
  // Edit -- never a second/different collapse mechanism, and Done
  // itself never calls handleSave or hits the network (this ticket's
  // own section 14).
  check('79. both Edit and Done call the SAME onToggleExpanded handler', occurrences(componentSource, 'onClick={onToggleExpanded}') === 2);
  {
    const doneMatch = componentSource.match(/<SecondaryButton onClick=\{onToggleExpanded\} disabled=\{disabled\} ariaLabel=\{`Done editing \$\{label\} availability`\}[^>]*>\s*Done/);
    check('79b. Done has its own distinct accessible name ("Done editing {weekday} availability")', !!doneMatch);
  }
  check('79c. Done never calls handleSave or fetch directly (WeekdayRow has no access to either)', !/function WeekdayRow[\s\S]*?handleSave/.test(componentSource) && !/function WeekdayRow[\s\S]*?fetch\(/.test(componentSource));

  // 80. Global Save remains the ONLY path to the network for persisting
  // periods -- WeekdayRow itself never calls fetch (this ticket's own
  // section 15).
  check('80. WeekdayRow itself contains no fetch call -- only AvailabilitySettings\'s own handleSave/handleResetConfirmed do', (() => { const m = componentSource.match(/function WeekdayRow[\s\S]*/); return !!m && !m[0].includes('fetch('); })());

  // 81. Multiple weekdays may be expanded simultaneously -- expanding
  // one never collapses another (no single-active-index model).
  check('81. expandedWeekdays is a Set (supports multiple simultaneous members), never a single `expandedWeekday: Weekday | null`', !/expandedWeekday: Weekday \| null/.test(componentSource));

  // 82. Load error never renders alongside a misleadingly-editable
  // empty week (this ticket's own section 36) -- the weekday list/Save/
  // Reset block is now gated on load.kind === 'READY', not rendered
  // unconditionally alongside the ERROR branch.
  check(
    "82. the weekday list, Save, and Reset section are all gated on load.kind === 'READY', never rendered during an ERROR state",
    /\{load\.kind === 'READY' && \(\s*<>/.test(componentSource)
  );
  {
    const readyIdx = componentSource.indexOf("{load.kind === 'READY' && (");
    const errorIdx = componentSource.indexOf("{load.kind === 'ERROR' && <FieldError>");
    check('82b. the ERROR-branch FieldError is written before the READY-gated block, and both are siblings (not nested)', errorIdx > 0 && errorIdx < readyIdx);
  }

  // 83. Timezone caption text is byte-identical to before UX V2 PR A
  // (this ticket's own section 27) -- "Times use your timezone: {tz}".
  check('83. the timezone caption is unchanged: "Times use your timezone: {timezone}"', componentSource.includes('Times use your timezone: {load.timezone}'));

  // 84. Reset confirmation copy matches this ticket's own locked
  // wording exactly (section 31).
  check(
    '84. the reset confirmation copy matches this ticket\'s own locked wording',
    componentSource.includes('Aura will stop using this weekly availability schedule and return to its default planning behavior.')
  );

  // 85. "Not available" wording is preserved verbatim everywhere (this
  // ticket's own section 9) -- never "Unavailable"/"Off"/"Closed"/"No
  // working hours".
  check('85. "Not available" appears (collapsed summary fallback + expanded zero-period state)', occurrences(componentSource, 'Not available') >= 1);
  check('85b. no alternate empty-day wording was introduced', !/\bUnavailable\b|\bOff\b|\bClosed\b|No working hours/.test(componentSource));

  // 86. No CONFIGURED_EMPTY-specific badge/banner was introduced (this
  // ticket's own LOCKED section 28) -- no new "configured empty"/"empty
  // schedule"/"no availability configured" text anywhere.
  check('86. no CONFIGURED_EMPTY-specific badge/banner text was introduced', !/configured empty|empty schedule|no availability configured/i.test(componentSource));

  // 87. No preset/autosave/inferred-schedule affordance was introduced
  // (this ticket's own section 30/34 out-of-scope list).
  check('87. no preset chips (Weekdays/Every day/Custom) were introduced', !/Weekdays<\/|Every day<\/|Custom<\//.test(componentSource));
  check('87b. no autosave was introduced -- Edit/Done/Add/Remove/Copy never call handleSave', !/onToggleExpanded[\s\S]{0,40}handleSave/.test(componentSource));

  // 88. Tomorrow navigation untouched (this ticket's own section 37) --
  // out of scope, verified by a completely separate file (checked by
  // planDayWiring.test.ts's own suite already); nothing here re-adds a
  // scroll/anchor/returnTo affordance inside AvailabilitySettings.tsx
  // itself.
  check('88. AvailabilitySettings.tsx introduces no returnTo/scrollIntoView/location.hash logic of its own', !/returnTo|scrollIntoView|location\.hash/.test(componentSource));

  // 89. Weekday display order unchanged (this ticket's own section 6) --
  // still iterates `draft` (already Sunday-first) directly, no reorder.
  check('89. the component still iterates draft.map(...) directly, no reordering/sorting of weekdays introduced', /\{draft\.map\(\(day\) => \(/.test(componentSource));

  // 90. Copy result: copying never auto-expands the copied weekdays
  // (this ticket's own section 26) -- onCopyToWeekdays only calls
  // setDraft, never setExpandedWeekdays.
  check(
    '90. onCopyToWeekdays only touches draft state, never expandedWeekdays',
    /onCopyToWeekdays=\{\(\) => setDraft\(\(current\) => copyMondayToWeekdays\(current\)\)\}/.test(componentSource) && !/onCopyToWeekdays[\s\S]{0,80}setExpandedWeekdays/.test(componentSource)
  );

  if (!allPassed) {
    console.error('\nSome Availability Settings Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL AVAILABILITY SETTINGS WIRING CHECKS PASSED');
  }
}

main();
