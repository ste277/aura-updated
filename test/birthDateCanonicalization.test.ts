/**
 * Birth Data Correctness B2 -- the civil birth date is stored as an explicit UTC-midnight surrogate (pure suite).
 *
 *   Part 1  `canonicalizeCivilBirthDate`: exact output, leap years, month / year boundaries, every date 1900-2100 round-trips through a UTC `Date`
 *   Part 2  rejection: anything that is not a real civil date is rejected (never normalized, never silently rolled)
 *   Part 3  the helper is pure string construction: no Date / Intl / clock / environment, so no process TZ, browser TZ or database TZ can reach it
 *   Part 4  the three production writers (`updateBirthProfile`, `createSavedPerson`, `updateSavedPerson`) pass ONLY the canonical surrogate -- a bare `input.birthDate` can
 *           never reach a SQL parameter again (in-memory mutations prove the guard)
 *   Part 5  the read-only operator diagnostic selects aggregate counts only
 *   Part 6  scope: no schema change, 43 migrations, Constructor hashes untouched, both new suites run in CI
 */
import fs from 'fs';
import path from 'path';
import { canonicalizeCivilBirthDate } from '../apps/web/lib/birthDate';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const rejects = (value: unknown): boolean => { try { canonicalizeCivilBirthDate(value as string); return false; } catch { return true; } };

// ---- Part 1
check('THE CONTRACT EXAMPLE: 1990-06-15 -> 1990-06-15T00:00:00.000Z', canonicalizeCivilBirthDate('1990-06-15') === '1990-06-15T00:00:00.000Z');
check('leap day, century non-leap, 400-year leap, month ends, year boundaries', canonicalizeCivilBirthDate('2000-02-29') === '2000-02-29T00:00:00.000Z' && canonicalizeCivilBirthDate('2024-02-29') === '2024-02-29T00:00:00.000Z' && canonicalizeCivilBirthDate('1999-12-31') === '1999-12-31T00:00:00.000Z' && canonicalizeCivilBirthDate('2000-01-01') === '2000-01-01T00:00:00.000Z' && canonicalizeCivilBirthDate('1970-03-08') === '1970-03-08T00:00:00.000Z' && canonicalizeCivilBirthDate('2023-04-30') === '2023-04-30T00:00:00.000Z' && canonicalizeCivilBirthDate('0001-01-01') === '0001-01-01T00:00:00.000Z');
{
  let bad = 0; let count = 0;
  for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
    const civil = new Date(t).toISOString().slice(0, 10);
    const canonical = canonicalizeCivilBirthDate(civil);
    count += 1;
    if (new Date(canonical).getTime() !== t || new Date(canonical).toISOString() !== canonical || canonical.slice(0, 10) !== civil) bad += 1;
  }
  check(`EVERY civil date 1900-01-01 .. 2100-12-31 (${count} dates): the canonical string is exactly that day's UTC midnight and its UTC date part is the civil date (the readers' convention)`, bad === 0 && count === 73414);
}

// ---- Part 2
check('NOT A REAL CALENDAR DATE is rejected, never rolled over: 2026-02-30, 2023-02-29, 1900-02-29, 2026-04-31, month 13 / 00, day 00 / 32', ['2026-02-30', '2023-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32'].every(rejects));
check('NOT THE ACCEPTED FORMAT is rejected, never silently broadened: unpadded, time suffix, offset, spaces, slashes, empty, year 0000', ['1990-6-15', '1990-06-5', '1990-06-15T10:00:00Z', '1990-06-15T00:00:00+05:30', ' 1990-06-15', '1990-06-15 ', '1990/06/15', '15-06-1990', '', '0000-01-01', '19900-06-15'].every(rejects));
check('NOT A STRING is rejected: Date, number, null, undefined, object', [new Date(0), 19900615, null, undefined, {}].every(rejects));
check('the rejection is a typed error (TypeError for format, RangeError for calendar) -- the same failure class as before (the database refused such a value), only earlier and deterministic', (() => { try { canonicalizeCivilBirthDate('nope'); } catch (e) { if (!(e instanceof TypeError)) return false; } try { canonicalizeCivilBirthDate('2026-02-30'); } catch (e) { return e instanceof RangeError; } return false; })());

// ---- Part 3
const helper = strip(read('apps/web/lib/birthDate.ts'));
check('PURE STRING CONSTRUCTION: the helper reads no Date, Intl, clock, randomness, environment or timezone, and imports nothing', !/\bDate\b|\bIntl\b|Date\.now|performance|Math\.random|process\.|\benv\b|\bTZ\b|toISOString|getTimezoneOffset|^import /m.test(helper));
check('the helper exports exactly one function, `canonicalizeCivilBirthDate`', JSON.stringify(Array.from(helper.matchAll(/^export (?:function|const|class|type|interface) (\w+)/gm)).map((m) => m[1])) === JSON.stringify(['canonicalizeCivilBirthDate']));
{
  // The helper is deterministic whatever the process timezone says (it never consults it); prove it across the representative zones, including changing the zone at runtime.
  const before = process.env.TZ;
  const outputs = new Set<string>();
  try { for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) { process.env.TZ = tz; outputs.add(canonicalizeCivilBirthDate('1990-06-15')); } } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  check('PROCESS TIMEZONE: the output is identical under UTC, Asia/Kolkata, America/Los_Angeles and Pacific/Auckland', outputs.size === 1 && [...outputs][0] === '1990-06-15T00:00:00.000Z');
}

// ---- Part 4
const WRITERS = ['updateBirthProfile', 'createSavedPerson', 'updateSavedPerson'];
const writerViolations = (db: string): string[] => {
  const v: string[] = [];
  const code = strip(db);
  if (!/^import \{ canonicalizeCivilBirthDate \} from '\.\/birthDate';$/m.test(code)) v.push('helper-not-imported');
  if ((code.match(/canonicalizeCivilBirthDate\(input\.birthDate\)/g) ?? []).length !== 3) v.push('not-exactly-three-canonical-writes');
  if ((code.match(/input\.birthDate/g) ?? []).length !== 3) v.push('input.birthDate-used-outside-the-helper');
  for (const name of WRITERS) {
    const start = code.indexOf(`export async function ${name}(`);
    const end = code.indexOf('\nexport ', start + 10);
    const body = start >= 0 ? code.slice(start, end < 0 ? undefined : end) : '';
    if (!body.includes('canonicalizeCivilBirthDate(input.birthDate)')) v.push(`writer-without-canonicalization:${name}`);
    if (/new Date\(|Date\.UTC|toISOString\(|AT TIME ZONE|::date/.test(body)) v.push(`writer-builds-its-own-date:${name}`);
  }
  return v;
};
const dbSrc = read('apps/web/lib/db.ts');
check('THE THREE WRITERS (updateBirthProfile, createSavedPerson, updateSavedPerson) each pass `canonicalizeCivilBirthDate(input.birthDate)` and nothing else can reach the birthDate parameter', writerViolations(dbSrc).length === 0);
check('MUTATION: a writer reverted to the bare `input.birthDate`, a fourth bare use, a writer building its own Date, and a missing import are each detected', writerViolations(dbSrc.replace('canonicalizeCivilBirthDate(input.birthDate), input.birthTime, input.birthCityName', 'input.birthDate, input.birthTime, input.birthCityName')).includes('writer-without-canonicalization:updateBirthProfile') && writerViolations(dbSrc.replace(/canonicalizeCivilBirthDate\(input\.birthDate\), \/\/ B2: explicit UTC-midnight surrogate, never a bare date string\n      input\.birthTime,\n      input\.birthTimezone/, 'input.birthDate,\n      input.birthTime,\n      input.birthTimezone')).some((x) => x.startsWith('writer-without-canonicalization')) && writerViolations(`${dbSrc}\nconst leaked = (input: { birthDate: string }) => input.birthDate;`).includes('input.birthDate-used-outside-the-helper') && writerViolations(dbSrc.replace('export async function createSavedPerson(ownerUserId: string, input: SavedPersonInput): Promise<SavedPerson> {', 'export async function createSavedPerson(ownerUserId: string, input: SavedPersonInput): Promise<SavedPerson> {\n  const own = new Date(input.birthDate);')).includes('writer-builds-its-own-date:createSavedPerson') && writerViolations(dbSrc.replace("import { canonicalizeCivilBirthDate } from './birthDate';\n", '')).includes('helper-not-imported'));

// ---- Part 5
const diagnostic = read('deploy/diagnostics/birth-date-surrogate-check.sql');
const diagnosticCode = diagnostic.replace(/--.*$/gm, '');
check('THE DIAGNOSTIC IS READ-ONLY AND AGGREGATE-ONLY: one SELECT ... UNION ALL SELECT, counts per table, no id / name / email / date / time / coordinate / city selected, no GROUP BY, no write', /^\s*SELECT[\s\S]*UNION ALL[\s\S]*;\s*$/.test(diagnosticCode) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COMMIT)\b/i.test(diagnosticCode) && !/GROUP BY|\bid\b|\bname\b|email|birthTime|birthCityName|Latitude|Longitude|birthTimezone/.test(diagnosticCode) && (diagnosticCode.match(/count\(\*\)/g) ?? []).length === 4 && !/SELECT[^;]*"birthDate"\s*(,|AS|FROM)/i.test(diagnosticCode.replace(/count\(\*\) FILTER \([^)]*\)/g, 'count')));
check('the diagnostic documents that non-midnight rows are evidence of shifted writes and that midnight rows are NOT certified correct, and that no automatic repair may be built from it', /EVIDENCE/.test(diagnostic) && /does NOT prove every row is right/.test(diagnostic) && /Do not repair rows from this output alone/.test(diagnostic) && /AT TIME ZONE 'UTC'/.test(diagnostic));

// ---- Part 6
const migrations = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
const ci = read('.github/workflows/ci.yml');
check('NO SCHEMA, NO MIGRATION: still 43 migrations and no schema.prisma mention of the helper', migrations === 43 && !/canonicalizeCivilBirthDate/.test(read('apps/web/prisma/schema.prisma')));
check('CI RUNS BOTH NEW SUITES: the pure canonicalization suite and the DB timezone-matrix suite', /npx ts-node test\/birthDateCanonicalization\.test\.ts/.test(ci) && /npx ts-node test\/birthDateWritersDb\.test\.ts/.test(ci));

if (!allPassed) { console.error('SOME BIRTH DATE CANONICALIZATION CHECKS FAILED'); process.exit(1); }
console.log('ALL BIRTH DATE CANONICALIZATION CHECKS PASSED');
