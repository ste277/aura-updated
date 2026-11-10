/**
 * AURA-PALM-01-I1 -- real mounted-component tests (jsdom + React 18 via
 * test/jsdomReactHarness.ts) for the Explore integration and the
 * Palmistry guide's interaction, keyboard and safety behaviour.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palm01I1ExploreJsdom.test.ts
 *
 * Scope (stated honestly): this mounts ExploreView and PalmistryView
 * directly with constructed props. page.tsx's tab orchestration is checked
 * via its real source text in section E (same technique as
 * homeRhythm01I1.test.ts), not by mounting the whole app. jsdom has no
 * layout engine, so visual focus rings, touch-target pixel sizes and
 * responsive layout are verified separately in a real browser, not here.
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, pressKey, flush, act } from './jsdomReactHarness';

const { ExploreView } = require('../apps/web/components/ExploreView');
const { PalmistryView, isPalmistryAvailable } = require('../apps/web/components/PalmistryView');
const { PALMISTRY_GENERAL_DISCLOSURE, PALMISTRY_LONGEVITY_DISCLOSURE, PALMISTRY_ENTRIES } = require('../packages/palmistry/src/content');

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

// Any network attempt during these mounts is recorded and fails the
// privacy checks below (the guide must not fetch anything itself).
const fetchCalls: string[] = [];
(global as any).fetch = (url: string) => {
  fetchCalls.push(String(url));
  return new Promise(() => {});
};

function makeSpies() {
  const calls: Record<string, unknown[][]> = {};
  const spy = (name: string) => (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  return { calls, spy };
}

async function run() {
  // ============================================================
  // A. Explore: three existing cards preserved, Palmistry is fourth
  // ============================================================
  {
    const { calls, spy } = makeSpies();
    const h = await mount(
      React.createElement(ExploreView, {
        timezone: 'Asia/Kolkata',
        onOpenPanchang: spy('panchang'),
        onOpenMuhurtham: spy('muhurtham'),
        onOpenMuhurthamWithActivity: spy('muhurthamWithActivity'),
        onOpenForwardPlanner: spy('planner'),
        onOpenPalmistry: spy('palmistry'),
      })
    );
    const cards = Array.from(h.container.querySelectorAll('button[aria-label]')).filter((b) => / — /.test(b.getAttribute('aria-label') ?? ''));
    const labels = cards.map((b) => b.getAttribute('aria-label'));
    check('A1. Explore renders exactly four feature cards', cards.length === 4);
    check('A2. first three cards are unchanged and in their original order', labels[0] === 'Panchang Calendar — Explore the day' && labels[1] === 'Muhurtham Finder — Find an auspicious time' && labels[2] === 'Plan Ahead — Find the best future time');
    check('A3. Palmistry is the fourth card', labels[3] === 'Palmistry — Learn the lines of the hand');
    check('A4. Palmistry card carries the approved description', /Explore traditional Indian interpretations of palm lines and symbols\./.test(cards[3]?.textContent ?? ''));
    check('A5. Quick Explore grid still renders', /Quick Explore/.test(h.container.textContent ?? ''));

    await click(cards[3]!);
    check('A6. selecting Palmistry calls onOpenPalmistry exactly once', (calls.palmistry ?? []).length === 1);
    check('A7. selecting Palmistry calls no other navigation callback', !calls.panchang && !calls.muhurtham && !calls.planner && !calls.muhurthamWithActivity);

    await click(cards[0]!);
    await click(cards[1]!);
    await click(cards[2]!);
    check('A8. the existing three cards still navigate to their own destinations', (calls.panchang ?? []).length === 1 && (calls.muhurtham ?? []).length === 1 && (calls.planner ?? []).length === 1);
    await h.unmount();
  }

  // A9-A13: launch gate -- with the gate closed (no onOpenPalmistry) the
  // Explore screen is exactly the original three cards.
  {
    const h = await mount(
      React.createElement(ExploreView, {
        timezone: 'Asia/Kolkata',
        onOpenPanchang: () => {},
        onOpenMuhurtham: () => {},
        onOpenMuhurthamWithActivity: () => {},
        onOpenForwardPlanner: () => {},
      })
    );
    const cards = Array.from(h.container.querySelectorAll('button[aria-label]')).filter((b) => / — /.test(b.getAttribute('aria-label') ?? ''));
    check('A9. gate closed: Explore shows only the original three cards', cards.length === 3 && !/Palmistry/.test(h.container.textContent ?? ''));
    await h.unmount();
  }
  check('A10. gate: pending content is hidden in a production build', isPalmistryAvailable('PENDING_HUMAN_REVIEW', 'production') === false);
  check('A11. gate: pending content is visible in local development', isPalmistryAvailable('PENDING_HUMAN_REVIEW', 'development') === true);
  check('A12. gate: approved content is visible in production', isPalmistryAvailable('APPROVED', 'production') === true);
  check('A13. gate: defaults read the real review status (pending -> hidden when NODE_ENV=production)', (() => {
    const prev = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    const result = isPalmistryAvailable();
    (process.env as any).NODE_ENV = prev;
    return result === false;
  })());

  // ============================================================
  // B. Palmistry guide: intro, disclosure, overview, selection
  // ============================================================
  {
    const { calls, spy } = makeSpies();
    const h = await mount(React.createElement(PalmistryView, { onBack: spy('back') }));
    const text = () => h.container.textContent ?? '';
    const q = <T extends Element>(sel: string) => h.container.querySelector<T>(sel as any) as T | null;

    check('B1. intro heading is shown', /Discover the traditions of Indian palmistry/.test(text()));
    const disclosure = q('[data-testid="palmistry-disclosure"]');
    check('B2. general disclosure is visible on the guide itself (not a separate page)', Boolean(disclosure) && (disclosure!.textContent ?? '').includes(PALMISTRY_GENERAL_DISCLOSURE));
    check('B3. disclosure is exposed as an accessible note', disclosure?.getAttribute('role') === 'note');
    check('B4. review-pending notice is shown (no fabricated approval)', Boolean(q('[data-testid="palmistry-review-notice"]')));
    check('B5. overview is shown before any selection', Boolean(q('[data-testid="palmistry-overview"]')));
    check('B6. longevity disclosure is not shown before ayurlekha is selected', !q('[data-testid="palmistry-longevity-disclosure"]'));

    // Text alternative lists every entry.
    const listButtons = Array.from(h.container.querySelectorAll<HTMLButtonElement>('[data-palm-list-entry]'));
    check('B7. text list offers every entry (text alternative to the diagram)', listButtons.length === PALMISTRY_ENTRIES.length);
    check('B8. list buttons are real <button>s with aria-pressed=false initially', listButtons.every((b) => b.tagName === 'BUTTON' && b.getAttribute('aria-pressed') === 'false'));

    const ayurButton = listButtons.find((b) => b.dataset.palmListEntry === 'ayurlekha')!;
    await click(ayurButton);
    const detail = () => q('[data-testid="palmistry-entry-detail"]');
    check('B9. selecting from the list shows that entry\'s detail', detail()?.getAttribute('data-entry-id') === 'ayurlekha');
    check('B10. detail shows title, traditional name, tradition and attribution', /Longevity line/.test(detail()!.textContent!) && /āyurlekhā/.test(detail()!.textContent!) && /Indian \(classical\)/.test(detail()!.textContent!) && /Classical source/.test(detail()!.textContent!));
    check('B11. detail shows source attribution', /Bṛhatsaṃhitā/.test(detail()!.textContent!) && /Zysk/.test(detail()!.textContent!));
    check('B12. longevity disclosure appears for ayurlekha', (q('[data-testid="palmistry-longevity-disclosure"]')?.textContent ?? '').includes(PALMISTRY_LONGEVITY_DISCLOSURE));
    check('B13. no numeric lifespan appears in the detail', !/\b\d{2,3}\s*years\b/i.test(detail()!.textContent!));
    check('B14. selected list button reports aria-pressed=true', ayurButton.getAttribute('aria-pressed') === 'true');
    check('B15. the matching SVG line is highlighted', h.container.querySelector('#palm-line-ayurlekha [data-selected="true"]') !== null);
    check('B16. selecting a feature makes no network request (no per-selection tracking)', fetchCalls.length === 0);
    const live = q('[data-testid="palmistry-live-status"]');
    check('B17. a short polite status announces the selection (not the whole entry)', live?.getAttribute('aria-live') === 'polite' && live?.textContent === 'Showing: Longevity line' && q('[data-testid="palmistry-detail"]')?.getAttribute('aria-live') === null);
    await flush();
    check('B17b. a list selection moves focus to the detail heading (brings it into view on phones)', (document.activeElement as HTMLElement | null)?.hasAttribute('data-detail-heading') === true && document.activeElement?.textContent === 'Longevity line');

    // Select another entry.
    const pitr = listButtons.find((b) => b.dataset.palmListEntry === 'pitrlekha')!;
    await click(pitr);
    check('B18. selecting another entry updates the explanation', detail()?.getAttribute('data-entry-id') === 'pitrlekha');
    check('B19. previous highlight is cleared', h.container.querySelector('#palm-line-ayurlekha [data-selected="true"]') === null && h.container.querySelector('#palm-line-pitrlekha [data-selected="true"]') !== null);
    check('B20. longevity disclosure is removed for other entries', !q('[data-testid="palmistry-longevity-disclosure"]'));

    // ============================================================
    // C. SVG keyboard + focus
    // ============================================================
    const svgLines = Array.from(h.container.querySelectorAll<SVGGElement>('g[role="button"]'));
    check('C1. the diagram exposes four focusable line controls', svgLines.length === 4 && svgLines.every((g) => g.getAttribute('tabindex') === '0'));
    check('C2. each line control has an accessible name', svgLines.every((g) => /^\d\. /.test(g.getAttribute('aria-label') ?? '')));
    const urdhva = h.container.querySelector<SVGGElement>('#palm-line-urdhvarekha')!;
    await act(async () => {
      (urdhva as any).focus();
    });
    check('C3. focusing a line draws a visible focus ring', urdhva.querySelector('[data-focus-ring="true"]') !== null);
    await pressKey(urdhva, 'Enter');
    check('C4. Enter on a focused line selects it', detail()?.getAttribute('data-entry-id') === 'urdhvarekha' && urdhva.getAttribute('aria-pressed') === 'true');
    const dhana = h.container.querySelector<SVGGElement>('#palm-line-dhanamatrlekha')!;
    await pressKey(dhana, ' ');
    check('C5. Space on a line selects it', detail()?.getAttribute('data-entry-id') === 'dhanamatrlekha');
    await pressKey(dhana, 'a');
    check('C6. other keys do not change selection', detail()?.getAttribute('data-entry-id') === 'dhanamatrlekha');
    await act(async () => {
      (dhana as any).blur();
    });
    check('C7. focus ring is removed on blur', dhana.querySelector('[data-focus-ring="true"]') === null);
    check('C8. selected state is not colour-only (thicker stroke + end markers)', dhana.querySelectorAll('circle').length >= 3);
    // Precise-hit layer (added after real-browser hit testing showed the
    // upward line's wide zone stealing taps at crossings).
    const precise = Array.from(h.container.querySelectorAll<SVGPathElement>('[data-precise-hit]'));
    check('C9. one precise-hit path per drawn line, inside an aria-hidden group', precise.length === 4 && precise.every((p) => p.parentElement?.getAttribute('aria-hidden') === 'true'));
    check('C10. precise layer is above every line group (last child of the SVG)', h.container.querySelector('svg[data-testid="palm-hand-diagram"]')?.lastElementChild?.contains(precise[0]!) === true);
    check('C11. the upward line is first in the precise layer (transverse lines win at crossings)', precise[0]!.getAttribute('data-precise-hit') === 'urdhvarekha');
    await click(precise.find((p) => p.getAttribute('data-precise-hit') === 'ayurlekha')!);
    check('C12. clicking a precise-hit path selects that line', detail()?.getAttribute('data-entry-id') === 'ayurlekha');
    // Focus return to the triggering control (review finding 14).
    const urdhvaG = h.container.querySelector<SVGGElement>('#palm-line-urdhvarekha')!;
    await act(async () => {
      (urdhvaG as any).focus();
    });
    await pressKey(urdhvaG, 'Enter');
    await flush();
    check('C13. a diagram selection keeps keyboard focus on the diagram line', document.activeElement === urdhvaG);
    await click(Array.from(h.container.querySelectorAll('button')).find((b) => /Back to overview/.test(b.textContent ?? ''))!);
    await flush();
    check('C14. "Back to overview" returns focus to the diagram line that opened the entry', document.activeElement === urdhvaG);

    // ============================================================
    // D. Marks, overview return, invalid selection, back
    // ============================================================
    const yava = listButtons.find((b) => b.dataset.palmListEntry === 'yava')!;
    await click(yava);
    check('D1. selecting a mark switches to the Marks view', h.container.querySelector('[data-testid="palm-hand-diagram"]') === null && h.container.querySelectorAll('button[data-entry-id]').length === 5);
    check('D2. mark detail says it is shown as a symbol only', /symbol only/i.test(detail()!.textContent!));
    check('D3. selected mark button reports aria-pressed=true', h.container.querySelector('button[data-entry-id="yava"]')?.getAttribute('aria-pressed') === 'true');

    const overviewBtn = Array.from(h.container.querySelectorAll('button')).find((b) => /Back to overview/.test(b.textContent ?? ''))!;
    await click(overviewBtn);
    await flush();
    check('D4. "Back to overview" returns to the overview', Boolean(q('[data-testid="palmistry-overview"]')) && !detail());
    check('D5. focus returns to the list entry that was open', document.activeElement === h.container.querySelector('[data-palm-list-entry="yava"]'));

    const tabs = Array.from(h.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    await click(tabs.find((t) => /Lines/.test(t.textContent ?? ''))!);
    check('D6. Lines tab restores the hand diagram', h.container.querySelector('[data-testid="palm-hand-diagram"]') !== null);

    const backBtn = h.container.querySelector<HTMLButtonElement>('button[aria-label="Back to Explore"]')!;
    await click(backBtn);
    check('D7. Back to Explore calls onBack once', (calls.back ?? []).length === 1);

    await h.unmount();
  }

  {
    const h = await mount(React.createElement(PalmistryView, { onBack: () => {}, initialEntryId: 'heart-line' }));
    check('D9. an invalid initial selection shows a safe notice, not a crash', Boolean(h.container.querySelector('[data-testid="palmistry-invalid-selection"]')));
    check('D10. invalid selection never renders a detail', !h.container.querySelector('[data-testid="palmistry-entry-detail"]'));
    const back = Array.from(h.container.querySelectorAll('button')).find((b) => /Back to overview/.test(b.textContent ?? ''))!;
    await click(back);
    check('D11. invalid notice recovers to the overview', Boolean(h.container.querySelector('[data-testid="palmistry-overview"]')));
    await h.unmount();
  }

  {
    const h = await mount(React.createElement(PalmistryView, { onBack: () => {}, initialEntryId: 'chatra' }));
    check('D12. a valid initial mark id opens that mark in the Marks view', h.container.querySelector('[data-testid="palmistry-entry-detail"]')?.getAttribute('data-entry-id') === 'chatra');
    await h.unmount();
  }

  // ============================================================
  // E. page.tsx tab wiring (real source text)
  // ============================================================
  const page = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');
  check('E1. AppTab union includes palmistry', /type AppTab = [^;]*'palmistry'/.test(page));
  check('E2. VALID_TABS includes palmistry only when the launch gate is open', /const palmistryAvailable = isPalmistryAvailable\(\);/.test(page) && /const VALID_TABS: AppTab\[\] = \(\[[^\]]*'palmistry'\] as AppTab\[\]\)\.filter\(\(tab\) => tab !== 'palmistry' \|\| palmistryAvailable\)/.test(page));
  check('E3. Explore opens the palmistry tab (not Home/Plan/Timeline), and only when the gate is open', /onOpenPalmistry=\{palmistryAvailable \? \(\) => setActiveTab\('palmistry'\) : undefined\}/.test(page));
  check('E4. Palmistry renders inside the shell with Back -> Explore, behind the gate', /activeTab === 'palmistry' && palmistryAvailable && <PalmistryView onBack=\{\(\) => setActiveTab\('explore'\)\} \/>/.test(page));
  check('E5. the Explore dock item stays highlighted on the palmistry tab', /label="Explore"[^\n]*activeTab === 'palmistry'/.test(page));
  check('E6. GUIDE_OPENED fires from the existing per-tab effect', /activeTab === 'palmistry'\) trackEvent\('PALMISTRY_GUIDE_OPENED'\)/.test(page));
  check('E7. no new routing framework (no next/navigation router push for palmistry)', !/router\.push\([^)]*palm/i.test(page) && !fs.existsSync(path.join(__dirname, '../apps/web/app/palmistry')));
  check('E8. dock still has six items', (page.match(/<NavButton label=/g) ?? []).length === 6);

  // ============================================================
  // F. Privacy during mounts
  // ============================================================
  check('F1. mounting and using the guide made no network request', fetchCalls.length === 0);
  {
    const h = await mount(React.createElement(PalmistryView, { onBack: () => {} }));
    check('F3. no <input type=file>, <video>, <canvas> or <img> in the guide', h.container.querySelectorAll('input[type="file"], video, canvas, img').length === 0);
    const links = Array.from(h.container.querySelectorAll<HTMLAnchorElement>('a[href]'));
    check('F4. external source links open safely (noopener)', links.length > 0 && links.every((a) => a.target === '_blank' && /noopener/.test(a.rel)));
    await h.unmount();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
