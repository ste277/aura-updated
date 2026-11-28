/**
 * AURA-DISC-01 -- the mounted guest /find "What are you planning?" picker:
 * six Popular chips, four collapsed categories that expand one at a time,
 * search, and selection into the UNCHANGED guest planning flow (details ->
 * /api/guest/timing-search, no sign-in). Onboarding's separate goal picker is
 * checked as a regression guard.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/disc01GuestActivityDiscoveryJsdom.test.ts
 */
import { React, mount, click, flush, typeInto } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Auto-responding fetch: guest session (signed out), product events, and a canned guest search. */
function installFetch(sessionUser: unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  (global as any).fetch = (url: string, opts?: any) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : undefined });
    if (url === '/api/auth/session') return Promise.resolve(res(200, { user: sessionUser }));
    if (url === '/api/guest/timing-search') return Promise.resolve(res(200, { candidates: [] }));
    return Promise.resolve(res(200, {}));
  };
  return calls;
}

const { GuestFindClient } = require('../apps/web/app/find/GuestFindClient');

(async () => {
  const calls = installFetch(null);
  const h = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
  await flush();
  const c = h.container as HTMLElement;
  const text = () => (c.textContent ?? '').replace(/\s+/g, ' ');
  const buttons = () => [...c.querySelectorAll('button')] as HTMLButtonElement[];
  const btn = (label: string) => buttons().find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().endsWith(label));
  const categoryButtons = () => [...c.querySelectorAll('[role=group][aria-label="Activity categories"] button')] as HTMLButtonElement[];
  const panel = () => c.querySelector('#guest-activity-category-panel');

  check('G1. guest (signed out) sees "What are you planning?" with no sign-in prompt', /What are you planning\?/.test(text()) && !c.querySelector('input[type=email]'));
  check('G1. only the session check ran (no auth required to browse)', calls.filter((x) => x.url !== '/api/product-events').map((x) => x.url).join(',') === '/api/auth/session');

  // Popular
  const popularHeading = [...c.querySelectorAll('label')].find((l) => l.textContent === 'Popular');
  const popularRow = popularHeading?.nextElementSibling as HTMLElement | undefined;
  const popularLabels = popularRow ? [...popularRow.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()) : [];
  check('P1. six Popular chips', popularLabels.length === 6);
  check('P2. Popular labels are the catalog titles', JSON.stringify(popularLabels) === JSON.stringify(['🏋️Workout', '🧠Deep Work', '❤️Date Night', '📚Learning', '☕Coffee / Tea', '🧘Meditation']));
  check('P3. Popular chips keep pill style + 38px touch height (ActivityChip)', !!popularRow && [...popularRow.querySelectorAll('button')].every((b) => /border-radius: 999px|border-radius: 9999px/.test(b.getAttribute('style') ?? '') || /min-height: 38px/.test(b.getAttribute('style') ?? '')));
  check('P4. Popular wraps (flex-wrap) so labels never overflow horizontally', /flex-wrap: wrap/.test(popularRow?.getAttribute('style') ?? ''));

  // Categories: collapsed initially
  const cats = categoryButtons();
  check('C1. four category buttons', cats.length === 4);
  check('C2. category labels', JSON.stringify(cats.map((b) => b.children[1]?.textContent)) === JSON.stringify(['Personal & Social', 'Work & Professional', 'Health & Fitness', 'Growth & Everyday Life']));
  check('C3. all categories start collapsed (not every activity on first screen)', cats.every((b) => b.getAttribute('aria-expanded') === 'false') && !panel());
  check('C4. category buttons are 44px touch targets', cats.every((b) => /min-height: 44px/.test(b.getAttribute('style') ?? '')));
  check('C5. category grid is two equal shrinkable columns (no horizontal overflow at 320px)', /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test((c.querySelector('[role=group][aria-label="Activity categories"]') as HTMLElement)?.getAttribute('style') ?? ''));
  check('C6. first-screen chip count is just Popular (6)', [...c.querySelectorAll('button[aria-pressed], button')].filter((b) => b.closest('#guest-activity-category-panel')).length === 0);

  // Expand Health & Fitness
  await click(cats[2]);
  check('E1. expanding Health & Fitness sets aria-expanded and aria-controls', cats[2].getAttribute('aria-expanded') === 'true' && cats[2].getAttribute('aria-controls') === 'guest-activity-category-panel');
  check('E2. panel is a labelled region', panel()?.getAttribute('role') === 'region' && panel()?.getAttribute('aria-label') === 'Health & Fitness activities');
  check('E3. Health & Fitness shows Workout, Meditation, Walk Together', JSON.stringify([...(panel()?.querySelectorAll('button') ?? [])].map((b) => b.lastChild?.textContent)) === JSON.stringify(['Workout', 'Meditation', 'Walk Together']));
  // Switch to Work: only one open at a time
  await click(cats[1]);
  check('E4. only one category open at a time', cats[1].getAttribute('aria-expanded') === 'true' && cats[2].getAttribute('aria-expanded') === 'false' && panel()?.getAttribute('aria-label') === 'Work & Professional activities');
  // Toggle closed
  await click(cats[1]);
  check('E5. tapping the open category collapses it', cats[1].getAttribute('aria-expanded') === 'false' && !panel());
  // Growth + Personal
  await click(cats[3]);
  check('E6. Growth & Everyday Life shows Learning and Family Outing', /Learning/.test(panel()?.textContent ?? '') && /Family Outing/.test(panel()?.textContent ?? ''));
  await click(cats[0]);
  check('E7. Personal & Social shows six', (panel()?.querySelectorAll('button').length ?? 0) === 6);

  // Search
  const search = c.querySelector('#guest-activity-search') as HTMLInputElement;
  check('S1. new placeholder', search?.getAttribute('placeholder') === 'e.g. Dinner, Workout, Focus...');
  check('S1. search is labelled', !!c.querySelector('label[for="guest-activity-search"]'));
  await typeInto(search, 'focus');
  const resultRow = () => search.nextElementSibling as HTMLElement | null;
  check('S2. "focus" finds Deep Work', /Deep Work/.test(resultRow()?.textContent ?? ''));
  await typeInto(search, 'walk');
  const walkLabels = [...(resultRow()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  check('S3. search results have no duplicates', walkLabels.length > 0 && walkLabels.length === new Set(walkLabels).size);
  await typeInto(search, '');
  check('S4. clearing the search hides results', !resultRow());

  // Select from a category -> existing DETAILS step -> existing guest search
  await click(cats[2]); // Health & Fitness
  const meditation = [...(panel()?.querySelectorAll('button') ?? [])].find((b) => /Meditation/.test(b.textContent ?? '')) as HTMLButtonElement;
  await click(meditation);
  await flush();
  check('N1. selecting a category activity opens the existing details step for it', /🧘 Meditation/.test(text()) && !/What are you planning\?/.test(text()));
  check('N2. still no sign-in on the details step', !c.querySelector('input[type=email]'));
  check('N2. meditation keeps its catalog duration metadata (10/20/30 min choices)', /10 min20 min30 min/.test(text()));
  await click(btn('Continue')!);
  check('N2. existing location step follows (unchanged "Where are you?")', /Where are you\?/.test(text()));
  const before = calls.length;
  await click(btn('Find my moment')!);
  await flush();
  const searchCall = calls.slice(before).find((x) => x.url === '/api/guest/timing-search');
  check('N3. search goes to the existing unauthenticated guest endpoint with the selected activityId', searchCall?.body?.activityId === 'meditation');
  check('N4. request shape is unchanged (activityId, horizon, timePreference, durationMinutes, cityName)', !!searchCall && JSON.stringify(Object.keys(searchCall.body).sort()) === JSON.stringify(['activityId', 'cityName', 'durationMinutes', 'horizon', 'timePreference']));
  check('N4. catalog default duration is passed through unchanged (meditation: 15)', searchCall?.body?.durationMinutes === require('../packages/recommendation/src/personalizedTasks').FULL_ACTIVITY_CATALOG.find((a: any) => a.id === 'meditation').defaultDurationMinutes);
  await h.unmount();

  // Selecting from Popular also enters the details step
  installFetch(null);
  const h2 = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
  await flush();
  const deep = [...h2.container.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '🧠Deep Work') as HTMLButtonElement;
  await click(deep);
  await flush();
  check('N5. selecting a Popular activity opens the details step for it', /🧠 Deep Work/.test(h2.container.textContent ?? ''));
  await h2.unmount();

  // Structural guards
  const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const guest = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/app/find/GuestFindClient.tsx'), 'utf8'));
  check('R1. signed-in visitors still route to the authenticated Plan flow on selection (AUTH-SESSION-01-I2-R1: only on a definitive signed-in answer; an unknown session decides nothing)', /const auth = await resolveAuthState\(\);\s*if \(auth === null\) return;[\s\S]{0,400}if \(auth === 'signed_in'\) \{\s*routeExistingUserToPlan\(/.test(guest));
  check('R2. every discovery surface selects via the single existing handleSelectActivity', (guest.match(/onClick=\{\(\) => handleSelectActivity\(a\.id\)\}/g) ?? []).length === 3);
  check('R3. guest endpoint and email save path unchanged', /'\/api\/guest\/timing-search'/.test(guest) && /Continue with email/.test(guest));
  const onboarding = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/OnboardingJourney.tsx'), 'utf8'));
  check('O1. onboarding goal step still uses its own ONBOARDING_GOAL_CATEGORIES (separate picker, unchanged)', /ONBOARDING_GOAL_CATEGORIES\.map/.test(onboarding) && !/guestActivityDiscovery/.test(onboarding));

  console.log(`\n${count} checks`);
  if (!allPassed) {
    console.log('SOME CHECKS FAILED');
    process.exit(1);
  }
  console.log('All AURA-DISC-01 component checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
