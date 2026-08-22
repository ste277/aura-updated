/**
 * Live-database CRUD + ownership test for SavedPerson. Requires a real,
 * reachable DATABASE_URL (this file makes actual INSERT/SELECT/UPDATE/
 * DELETE calls against Postgres via apps/web/lib/db.ts's pg Pool) -- NOT
 * part of ci.yml's math-core-tests job, which has no Postgres service
 * provisioned. Run locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/savedPersonDb.test.ts
 *
 * Creates two throwaway test users (idempotent via email upsert) and
 * cleans up every SavedPerson row it creates, but leaves the two test User
 * rows in place (harmless, matches how other manual verification in this
 * repo works -- they're clearly named and email-identifiable).
 */
import { createSavedPerson, deleteSavedPerson, getSavedPersonForOwner, listSavedPeople, updateSavedPerson, upsertUserByEmail } from '../apps/web/lib/db';
import { getSavedPersonNatalContext } from '../apps/web/lib/savedPersonNatalContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-saved-person-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const ownerB = await upsertUserByEmail({ email: 'test-saved-person-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const createdIds: string[] = [];

  try {
    // ============================================================
    // CREATE
    // ============================================================
    const anu = await createSavedPerson(ownerA.id, {
      name: 'Anu',
      relationshipType: 'PARTNER',
      birthDate: '1992-03-14',
      birthTime: '08:15',
      birthTimezone: 'Asia/Kolkata',
      birthCityName: 'Chennai',
      birthLatitude: 13.0827,
      birthLongitude: 80.2707,
    });
    createdIds.push(anu.id);
    check('createSavedPerson returns a persisted row with an id', Boolean(anu.id));
    check('createSavedPerson persists the exact name/relationship submitted', anu.name === 'Anu' && anu.relationshipType === 'PARTNER');
    check('createSavedPerson is owned by the creating user', anu.ownerUserId === ownerA.id);

    // ============================================================
    // LIST -- only current user's people
    // ============================================================
    const ravi = await createSavedPerson(ownerA.id, { name: 'Ravi', relationshipType: 'FAMILY', birthDate: '1988-11-02', birthTime: '14:00', birthTimezone: 'America/New_York' });
    createdIds.push(ravi.id);
    const ownerBPerson = await createSavedPerson(ownerB.id, { name: 'Someone Else', relationshipType: 'FRIEND', birthDate: '1995-01-01', birthTime: '10:00', birthTimezone: 'Asia/Kolkata' });
    createdIds.push(ownerBPerson.id);

    const listA = await listSavedPeople(ownerA.id);
    check('listSavedPeople returns exactly ownerA\'s people, in alphabetical order', listA.map((p) => p.name).sort().join(',') === 'Anu,Ravi'.split(',').sort().join(','));
    check('listSavedPeople for ownerA never includes ownerB\'s person', !listA.some((p) => p.id === ownerBPerson.id));

    const listB = await listSavedPeople(ownerB.id);
    check('listSavedPeople for ownerB only returns ownerB\'s person', listB.length === 1 && listB[0].id === ownerBPerson.id);

    // ============================================================
    // OWNERSHIP: cannot access another user's record
    // ============================================================
    const crossOwnerFetch = await getSavedPersonForOwner(ownerB.id, anu.id);
    check('getSavedPersonForOwner returns null when the id belongs to a DIFFERENT owner (ownerB requesting ownerA\'s person)', crossOwnerFetch === null);

    let crossOwnerUpdateThrew = false;
    try {
      await updateSavedPerson(ownerB.id, anu.id, { name: 'Hijacked', relationshipType: 'OTHER', birthDate: '2000-01-01', birthTime: '00:00', birthTimezone: 'UTC' });
    } catch {
      crossOwnerUpdateThrew = true;
    }
    check('updateSavedPerson throws when ownerB attempts to update ownerA\'s person', crossOwnerUpdateThrew);

    let crossOwnerDeleteThrew = false;
    try {
      await deleteSavedPerson(ownerB.id, anu.id);
    } catch {
      crossOwnerDeleteThrew = true;
    }
    check('deleteSavedPerson throws when ownerB attempts to delete ownerA\'s person', crossOwnerDeleteThrew);

    const stillThere = await getSavedPersonForOwner(ownerA.id, anu.id);
    check('The cross-owner update/delete attempts left ownerA\'s record completely untouched', stillThere !== null && stillThere.name === 'Anu');

    // ============================================================
    // UPDATE (by the correct owner)
    // ============================================================
    const updated = await updateSavedPerson(ownerA.id, anu.id, {
      name: 'Anu Updated',
      relationshipType: 'SPOUSE',
      birthDate: '1992-03-14',
      birthTime: '08:15',
      birthTimezone: 'Asia/Kolkata',
    });
    check('updateSavedPerson (correct owner) succeeds and persists the change', updated.name === 'Anu Updated' && updated.relationshipType === 'SPOUSE');

    // ============================================================
    // DERIVED NATAL CONTEXT
    // ============================================================
    const natalContext = await getSavedPersonNatalContext(anu.id, ownerA.id);
    check('getSavedPersonNatalContext returns a natal context for a valid, owned person', natalContext !== null);
    check('getSavedPersonNatalContext derives a Janma Nakshatra', Boolean(natalContext?.janmaNakshatra));
    check('getSavedPersonNatalContext derives a Janma Rashi', Boolean(natalContext?.janmaRashi));

    const crossOwnerNatalContext = await getSavedPersonNatalContext(anu.id, ownerB.id);
    check('getSavedPersonNatalContext returns null (not another owner\'s data) when called with the wrong owner', crossOwnerNatalContext === null);

    // ============================================================
    // DELETE (by the correct owner)
    // ============================================================
    await deleteSavedPerson(ownerA.id, anu.id);
    const afterDelete = await getSavedPersonForOwner(ownerA.id, anu.id);
    check('deleteSavedPerson (correct owner) actually removes the row', afterDelete === null);
    createdIds.splice(createdIds.indexOf(anu.id), 1);
  } finally {
    // Clean up every row this test created (best-effort).
    for (const id of createdIds) {
      await deleteSavedPerson(ownerA.id, id).catch(() => {});
      await deleteSavedPerson(ownerB.id, id).catch(() => {});
    }
  }

  console.log(allPassed ? '\nALL SAVED PERSON DB CHECKS PASSED' : '\nSOME SAVED PERSON DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
