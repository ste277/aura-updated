/**
 * AURA-MP-2 (62016 completion) -- focused regression: the My People PEOPLE
 * LIST annotates a 29 February special day observed on 28 February with
 * "(for 29 Feb)", consistent with Coming up and the person detail (D4).
 *
 * Deterministic (no dependence on today's date): fetch is mocked with the
 * exact MP-1 response shapes; real React + jsdom render the real screen.
 * Also pins: a REAL 28 February is never annotated; Coming up still shows
 * only the next 30 days; the upcoming request stays within the API's 1-60
 * window; and the annotation needs the server's enabled confirmation.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp2LeapDayJsdom.test.ts
 */
import { React, mount, act } from './jsdomReactHarness';

process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1';
const { PeopleView } = require('../apps/web/components/PeopleView');
const { personNextOccasionLine } = require('../apps/web/lib/myPeopleOccasionUi');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!condition) allPassed = false;
}

// List items exactly as GET /api/people returns them while enabled (MP-1 4.1).
const LEAP = { id: 'p-leap', name: 'Leela', relationshipType: 'SIBLING', relationshipLabel: null, hasChartDetails: false, nextOccasion: { id: 'o-leap', kind: 'BIRTHDAY', label: null, date: '2027-02-28', daysUntil: 45 } };
const REAL28 = { id: 'p-real', name: 'Ravi', relationshipType: 'FRIEND', relationshipLabel: null, hasChartDetails: false, nextOccasion: { id: 'o-real', kind: 'BIRTHDAY', label: null, date: '2027-02-28', daysUntil: 45 } };
const SOON = { id: 'p-soon', name: 'Sita', relationshipType: 'FRIEND', relationshipLabel: null, hasChartDetails: false, nextOccasion: { id: 'o-soon', kind: 'ANNIVERSARY', label: null, date: '2027-01-20', daysUntil: 10 } };
// GET /api/people/occasions/upcoming items (MP-1 shape).
const up = (o: any, personId: string, personName: string, observedFromLeapDay: boolean) => ({ occasionId: o.id, personId, personName, kind: o.kind, label: o.label, date: o.date, daysUntil: o.daysUntil, turning: null, observedFromLeapDay, surfaced: false });
const UPCOMING = [up(SOON.nextOccasion, SOON.id, SOON.name, false), up(LEAP.nextOccasion, LEAP.id, LEAP.name, true), up(REAL28.nextOccasion, REAL28.id, REAL28.name, false)];

let serverHeader = 'enabled';
const urls: string[] = [];
(global as any).fetch = async (url: string) => {
  urls.push(url);
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => (n === 'x-aura-my-people' ? serverHeader : null) }, json: async () => body });
  if (url === '/api/people') return reply(200, [SOON, LEAP, REAL28]);
  if (url.startsWith('/api/people/occasions/upcoming')) return serverHeader === 'enabled' ? reply(200, UPCOMING) : reply(404, {});
  if (url === '/api/cities/custom') return reply(200, []);
  return reply(404, {});
};

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const card = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'View').map((b) => b.closest('div')?.parentElement?.textContent ?? '').find((t) => t.includes(name)) ?? '';

async function main() {
  // ---- pure helper ----
  check('helper: leap-day flag from upcoming -> "(for 29 Feb)"', personNextOccasionLine(LEAP.nextOccasion, UPCOMING) === 'Sun 28 Feb (for 29 Feb) · In 45 days');
  check('helper: a real 28 February (flag false) is not annotated', personNextOccasionLine(REAL28.nextOccasion, UPCOMING) === 'Sun 28 Feb · In 45 days');
  check('helper: no upcoming data -> no annotation (never inferred from the date)', personNextOccasionLine(LEAP.nextOccasion, []) === 'Sun 28 Feb · In 45 days');

  // ---- real screen, My People effective ----
  {
    const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
    await settle();
    const root = h.container as HTMLElement;
    const upUrl = urls.find((u) => u.startsWith('/api/people/occasions/upcoming')) ?? '';
    const days = Number(new URL(`http://x${upUrl}`).searchParams.get('days'));
    check('upcoming is requested once, within the API window (1-60) and covering the list window (60)', urls.filter((u) => u.startsWith('/api/people/occasions/upcoming')).length === 1 && days === 60, urls);
    check('people list: Leela\'s 29 Feb birthday observed on 28 Feb shows "(for 29 Feb)"', /Sun 28 Feb \(for 29 Feb\) · In 45 days/.test(card(root, 'Leela')), card(root, 'Leela'));
    check('people list: Ravi\'s real 28 Feb birthday is NOT annotated', /Sun 28 Feb · In 45 days/.test(card(root, 'Ravi')) && !/for 29 Feb/.test(card(root, 'Ravi')), card(root, 'Ravi'));
    const coming = root.querySelector('[data-testid="my-people-coming-up"]')?.textContent ?? '';
    check('Coming up still shows only the next 30 days (Sita at 10 days; the 45-day birthdays are not in it)', /Sita's anniversary/.test(coming) && !/Leela|Ravi/.test(coming), coming);
    await h.unmount();
  }

  // ---- server not confirming: legacy screen, no upcoming request, no annotation ----
  {
    serverHeader = 'disabled';
    urls.length = 0;
    const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
    await settle();
    const root = h.container as HTMLElement;
    check('server disabled: no upcoming request and no special-day line or annotation (legacy list)', !urls.some((u) => u.includes('/occasions/upcoming')) && !/for 29 Feb|In 45 days/.test(root.textContent ?? ''), { urls, text: root.textContent });
    await h.unmount();
  }

  console.log(allPassed ? `\nALL MY PEOPLE MP-2 LEAP-DAY LIST CHECKS PASSED (${count})` : '\nSOME MY PEOPLE MP-2 LEAP-DAY LIST CHECKS FAILED');
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(() => process.exit(allPassed ? 0 : 1));
