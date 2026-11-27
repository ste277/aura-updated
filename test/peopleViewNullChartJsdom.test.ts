/**
 * AURA-MP-1 -- the EXISTING People screen (components/PeopleView.tsx) with a
 * person saved WITHOUT birth details (switch-off rollback safety, R2).
 * Before MP-1 the detail view crashed at `person.birthDate.slice` and the
 * edit form demanded birth details. Now (fetch mocked, real React + jsdom):
 *   - the list and the detail render; the detail says "No birth details saved";
 *   - an edit of that person can change name/relationship and sends NO chart
 *     keys, so the partial PATCH leaves every other saved field untouched;
 *   - a half-filled chart (date without time) is refused client-side;
 *   - a person WITH a chart still edits exactly as before (full chart sent);
 *   - My People relationship types render labelled even with the switch off;
 *   - personHasChartDetails() is what the SHARED Muhurtham picker filters on.
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';

process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '0'; // the rollback state: My People switched off
const { PeopleView, personHasChartDetails, RELATIONSHIP_LABEL } = require('../apps/web/components/PeopleView');

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!condition) allPassed = false;
}

const NAME_ONLY = { id: 'p-meera', name: 'Meera', relationshipType: 'SIBLING', birthDate: null, birthTime: null, birthTimezone: null, birthCityName: null, birthLatitude: null, birthLongitude: null, hasChartDetails: false };
const WITH_CHART = { id: 'p-priya', name: 'Priya', relationshipType: 'PARTNER', birthDate: '1993-07-21T00:00:00.000Z', birthTime: '06:40', birthTimezone: 'Asia/Kolkata', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, hasChartDetails: true };

const calls: Array<{ url: string; method: string; body: any }> = [];
(global as any).fetch = async (url: string, init: any) => {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  if (url === '/api/cities/custom') return reply(200, []);
  if (url === '/api/people' && method === 'GET') return reply(200, [NAME_ONLY, WITH_CHART]);
  if (url === `/api/people/${NAME_ONLY.id}` && method === 'GET') return reply(200, { ...NAME_ONLY, natalContext: null });
  if (url === `/api/people/${WITH_CHART.id}` && method === 'GET') return reply(200, { ...WITH_CHART, natalContext: { janmaNakshatra: 'Rohini', janmaRashi: 'Vrishabha', moonElement: 'Earth' } });
  if (method === 'PATCH') return reply(200, {});
  return reply(404, {});
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const buttonByText = (root: HTMLElement, text: string) => buttons(root).find((b) => b.textContent?.trim() === text);
const submit = (form: HTMLFormElement) => act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)); });

async function openEdit(root: HTMLElement, personIndex: number) {
  const view = buttons(root).filter((b) => b.textContent?.trim() === 'View')[personIndex];
  await click(view);
  await flush();
  await click(buttonByText(root, 'Edit')!);
  await flush();
}

async function main() {
  check('personHasChartDetails: false for a name-only person, true for a chart person', personHasChartDetails(NAME_ONLY) === false && personHasChartDetails(WITH_CHART) === true);
  check('My People relationship types are always labelled (render safely with the switch off)', RELATIONSHIP_LABEL.SIBLING === 'Sibling' && RELATIONSHIP_LABEL.PARENT === 'Parent' && RELATIONSHIP_LABEL.CHILD === 'Child');

  // ---- name-only person: list, detail, edit ----
  {
    const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
    await flush();
    const root = h.container;
    check('list renders both people, including the name-only one with its label', /Meera/.test(root.textContent ?? '') && /Sibling/.test(root.textContent ?? '') && /Priya/.test(root.textContent ?? ''));
    const view = buttons(root).filter((b) => b.textContent?.trim() === 'View')[0];
    await click(view);
    await flush();
    check('detail of a name-only person renders (no crash) and says "No birth details saved"', Boolean(root.querySelector('[data-testid="person-no-birth-details"]')) && /No birth details saved/.test(root.textContent ?? ''));
    check('delete confirmation copy states what is deleted and that plans stay', await (async () => {
      await click(buttons(root).find((b) => /Remove Meera/.test(b.textContent ?? ''))!);
      return /special days will be deleted\. Your plans stay in your calendar/.test(root.textContent ?? '');
    })());
    await click(buttonByText(root, 'Cancel')!);
    await click(buttonByText(root, 'Edit')!);
    await flush();
    const date = root.querySelector('#person-birth-date') as HTMLInputElement;
    const time = root.querySelector('#person-birth-time') as HTMLInputElement;
    check('edit form: birth date and time are NOT required for a person saved without them', date && time && !date.required && !time.required);
    const relationship = root.querySelector('#person-relationship') as HTMLSelectElement;
    check('edit form: the person\'s own My People type (Sibling) is offered so it is not silently changed; other My People types are not offered while off', Array.from(relationship.options).some((o) => o.value === 'SIBLING') && !Array.from(relationship.options).some((o) => o.value === 'PARENT'));

    await typeInto(root.querySelector('#person-name') as HTMLInputElement, 'Meera R');
    await submit(root.querySelector('form') as HTMLFormElement);
    const patch = calls.filter((c) => c.method === 'PATCH').pop();
    check('saving a name change sends PATCH with name + relationship and NO chart keys', patch?.url === `/api/people/${NAME_ONLY.id}` && patch.body.name === 'Meera R' && !('birthDate' in patch.body) && !('birthTime' in patch.body) && !('birthTimezone' in patch.body), patch);

    // half-filled chart is refused client-side (saving returned to the detail view; edit again)
    await flush();
    const editAgain = buttonByText(root, 'Edit');
    if (editAgain) {
      await click(editAgain);
      await flush();
    }
    const form2 = root.querySelector('form') as HTMLFormElement | null;
    if (form2) {
      const before = calls.filter((c) => c.method === 'PATCH').length;
      await typeInto(root.querySelector('#person-birth-date') as HTMLInputElement, '1990-02-01');
      await submit(form2);
      check('a birth date without a birth time is refused before any request', calls.filter((c) => c.method === 'PATCH').length === before && /both a birth date and a birth time/.test(root.textContent ?? ''));
    } else {
      check('a birth date without a birth time is refused before any request', false, 'edit form not reached');
    }
    await h.unmount();
  }

  // ---- chart person: unchanged legacy behaviour ----
  {
    const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
    await flush();
    const root = h.container;
    await openEdit(root, 1);
    const date = root.querySelector('#person-birth-date') as HTMLInputElement;
    check('edit form for a chart person: birth date and time stay required, prefilled', date.required && date.value === '1993-07-21');
    await submit(root.querySelector('form') as HTMLFormElement);
    const patch = calls.filter((c) => c.method === 'PATCH').pop();
    check('saving a chart person sends the full chart, exactly as before', patch?.url === `/api/people/${WITH_CHART.id}` && patch.body.birthDate === '1993-07-21' && patch.body.birthTime === '06:40' && typeof patch.body.birthTimezone === 'string', patch);
    await h.unmount();
  }

  if (!allPassed) {
    console.error('\nSOME PEOPLE VIEW NULL-CHART CHECKS FAILED');
    process.exit(1);
  }
  console.log('\nALL PEOPLE VIEW NULL-CHART CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
