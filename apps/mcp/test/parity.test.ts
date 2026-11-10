import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { buildTimingSearchRequest } from '../../web/lib/timingSearchRequest';
import { runTimingSearchWithDailyRhythm, type TimingSearchResponseWithDailyRhythm } from '../../web/lib/timingSearchDailyRhythm';
import type { DailyRhythmPreferencesInput } from '../../web/lib/dailyRhythmScheduling';
import { resolveTzOffsetMinutes } from '../../web/lib/timezone';
import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import { CHENNAI, LOS_ANGELES, SVALBARD, connectClient } from './helpers';

/**
 * Timing Search parity: the MCP tool, called over a real stdio MCP session,
 * must return exactly what the existing NON-PERSONALIZED pipeline returns for
 * the same explicit inputs. The reference result below is built
 * independently of the tool adapter, mirroring
 * apps/web/app/api/timing-search/route.ts with the user row replaced by the
 * same explicit values and no personalContext.
 *
 * SCOPE: these tests cover the non-personalized path only. They make no claim
 * about the authenticated UI's personalized results, which add a
 * birth-profile `personalContext` the MCP server never has.
 */

type Args = {
  activityId?: string;
  taskTitle?: string;
  durationMinutes: number;
  location: { latitude: number; longitude: number };
  timezone: string;
  referenceTime: string;
  dateRange?: { start: string; end: string };
  horizon?: string;
  timePreference?: string;
  limit?: number;
  dailyRhythm?: { workStart: string; workEnd: string; workDays: number[] };
};

function referencePipeline(args: Args): TimingSearchResponseWithDailyRhythm {
  const now = new Date(args.referenceTime);
  const context: DailyAssistantContext = {
    now,
    latitude: args.location.latitude,
    longitude: args.location.longitude,
    timezone: args.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(args.timezone, now),
  };
  const body: Record<string, unknown> = { mode: 'FIND', durationMinutes: args.durationMinutes };
  for (const key of ['activityId', 'taskTitle', 'timePreference', 'limit', 'dateRange', 'horizon'] as const) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  const validated = buildTimingSearchRequest(body, context);
  if (!validated.ok) throw new Error(`reference request invalid: ${validated.error}`);
  const prefs: DailyRhythmPreferencesInput = args.dailyRhythm
    ? { workStart: args.dailyRhythm.workStart, workEnd: args.dailyRhythm.workEnd, workDays: args.dailyRhythm.workDays }
    : { workStart: null, workEnd: null, workDays: [] };
  // JSON round trip = exactly what crosses the MCP wire.
  return JSON.parse(JSON.stringify(runTimingSearchWithDailyRhythm(validated.request, args.timezone, prefs)));
}

let client: Client;
before(async () => {
  ({ client } = await connectClient());
});
after(async () => {
  await client.close();
});

async function callTool(args: Args): Promise<Record<string, any>> {
  const result = await client.callTool({ name: 'find_best_time', arguments: args });
  assert.notEqual(result.isError, true, `tool error: ${JSON.stringify(result.content)}`);
  return result.structuredContent as Record<string, any>;
}

/** Full-fidelity comparison: every candidate field, order, notes and availability. */
async function assertParity(args: Args): Promise<{ tool: Record<string, any>; reference: TimingSearchResponseWithDailyRhythm }> {
  const [tool, reference] = [await callTool(args), referencePipeline(args)];

  assert.equal(tool.personalized, false);
  assert.equal(tool.mode, reference.mode);

  const toolCandidates = tool.candidates.map(({ rank, dailyRhythmNote, ...rest }: any) => rest);
  assert.deepEqual(toolCandidates, reference.candidates, 'candidates identical: start/end, order, score, label, muhurtaScore, auraFitScore, reasons, conflicts, metadata');
  assert.deepEqual(tool.candidates.map((c: any) => c.rank), reference.candidates.map((_, i) => i + 1), 'rank follows pipeline order');

  const toolNotes = Object.fromEntries(tool.candidates.filter((c: any) => c.dailyRhythmNote !== undefined).map((c: any) => [c.start, c.dailyRhythmNote]));
  assert.deepEqual(toolNotes, reference.dailyRhythmNotes ?? {}, 'Daily Rhythm notes identical');

  assert.equal(tool.unavailableDayCount, reference.unavailableDayCount);
  assert.deepEqual(tool.unavailable, reference.unavailable);
  assert.equal(tool.query.timezone, args.timezone);
  assert.equal(tool.query.referenceTime, new Date(args.referenceTime).toISOString());
  assert.equal(tool.query.tzOffsetMinutes, resolveTzOffsetMinutes(args.timezone, new Date(args.referenceTime)));
  return { tool, reference };
}

const CHENNAI_BASE = { location: CHENNAI, timezone: 'Asia/Kolkata', referenceTime: '2026-11-09T00:00:00+05:30' };

test('ordinary valid search (catalog activity, default limit)', async () => {
  const { tool } = await assertParity({ ...CHENNAI_BASE, activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-11-10', end: '2026-11-10' } });
  assert.equal(tool.candidates.length, 3);
});

test('favorable window ranked first (free text, Abhijit/Brahma)', async () => {
  const { tool } = await assertParity({ ...CHENNAI_BASE, taskTitle: 'Start a new business', durationMinutes: 60, limit: 10, dateRange: { start: '2026-11-14', end: '2026-11-14' } });
  assert.ok(['EXCELLENT', 'VERY_GOOD', 'GOOD'].includes(tool.candidates[0].label));
});

test('caution is preserved, not hidden or converted (Abhijit candidate labelled CAUTION)', async () => {
  const { tool } = await assertParity({ ...CHENNAI_BASE, taskTitle: 'Start a new business', durationMinutes: 60, limit: 10, dateRange: { start: '2026-11-13', end: '2026-11-13' } });
  const abhijit = tool.candidates.find((c: any) => c.metadata.windowType === 'ABHIJIT');
  assert.ok(abhijit, 'Abhijit candidate present');
  assert.equal(abhijit.label, 'CAUTION', 'Abhijit is not unconditionally favorable');
  assert.ok(abhijit.reasons.some((r: any) => r.polarity === 'CAUTION'), 'caution reasons passed through');
  assert.equal(typeof abhijit.score, 'number', 'continuous score kept, not a boolean');
});

test('multi-candidate ranking across a multi-day range', async () => {
  const { tool } = await assertParity({ ...CHENNAI_BASE, activityId: 'deep-work', durationMinutes: 90, limit: 10, dateRange: { start: '2026-11-10', end: '2026-11-16' } });
  assert.ok(tool.candidates.length > 3);
});

test('relative horizon resolved from referenceTime (SEVEN_DAYS, TOMORROW)', async () => {
  await assertParity({ ...CHENNAI_BASE, activityId: 'meditation', durationMinutes: 30, horizon: 'SEVEN_DAYS', limit: 5 });
  await assertParity({ ...CHENNAI_BASE, activityId: 'meditation', durationMinutes: 30, horizon: 'TOMORROW', timePreference: 'MORNING' });
});

test('date boundary: US DST change (America/Los_Angeles, 2026-11-01)', async () => {
  const { tool } = await assertParity({ location: LOS_ANGELES, timezone: 'America/Los_Angeles', referenceTime: '2026-10-30T12:00:00-07:00', activityId: 'workout', durationMinutes: 60, limit: 10, dateRange: { start: '2026-10-31', end: '2026-11-02' } });
  assert.ok(tool.candidates.length > 0);
});

test('timezone-sensitive: same coordinates, different IANA zone changes interpretation', async () => {
  const args = { location: CHENNAI, referenceTime: '2026-11-09T00:00:00Z', activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-11-10', end: '2026-11-10' } };
  const ist = await assertParity({ ...args, timezone: 'Asia/Kolkata' });
  const utc = await assertParity({ ...args, timezone: 'Europe/London' });
  assert.equal(ist.tool.query.tzOffsetMinutes, 330, 'half-hour offset honoured');
  assert.notDeepEqual(ist.tool.candidates.map((c: any) => c.start), utc.tool.candidates.map((c: any) => c.start));
});

test('Daily Rhythm supplied: notes and outside-work preference match the pipeline', async () => {
  const { tool } = await assertParity({ ...CHENNAI_BASE, activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-11-10', end: '2026-11-10' }, dailyRhythm: { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] } });
  assert.ok(tool.candidates.every((c: any) => typeof c.dailyRhythmNote === 'string'));
  assert.deepEqual(tool.query.dailyRhythm, { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] });
});

test('Daily Rhythm omitted: no notes, no preference applied, results differ from the rhythm case', async () => {
  const base = { ...CHENNAI_BASE, activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-11-10', end: '2026-11-10' } };
  const without = await assertParity(base);
  const withRhythm = await callTool({ ...base, dailyRhythm: { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] } });
  assert.equal(without.tool.query.dailyRhythm, null);
  assert.ok(without.tool.candidates.every((c: any) => c.dailyRhythmNote === undefined));
  assert.equal(without.reference.dailyRhythmNotes, undefined);
  assert.notDeepEqual(without.tool.candidates.map((c: any) => c.start), withRhythm.candidates.map((c: any) => c.start));
});

test('solar calculation unavailable (polar night) is reported, not fabricated', async () => {
  const { tool } = await assertParity({ location: SVALBARD, timezone: 'Arctic/Longyearbyen', referenceTime: '2026-12-19T00:00:00Z', activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-12-20', end: '2026-12-21' } });
  assert.deepEqual(tool.candidates, []);
  assert.equal(tool.unavailable?.reason, 'SOLAR_NO_EVENT');
  assert.equal(tool.unavailableDayCount, 2);
});

test('invalid input produces no result over the protocol', async () => {
  const result = await client.callTool({ name: 'find_best_time', arguments: { ...CHENNAI_BASE, activityId: 'workout', durationMinutes: 45, dateRange: { start: '2026-11-10', end: '2026-02-30' } } });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as any)?.candidates, undefined);
});

test('determinism: identical calls return identical results', async () => {
  const args = { ...CHENNAI_BASE, activityId: 'deep-work', durationMinutes: 60, limit: 10, horizon: 'SEVEN_DAYS' };
  assert.deepEqual(await callTool(args), await callTool(args));
});
