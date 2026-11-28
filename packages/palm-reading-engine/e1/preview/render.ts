/**
 * AURA-PALM-04-I4 (plan G-6, decision D1) -- the STANDALONE E1 READING PREVIEW HARNESS.
 * DEVELOPMENT ONLY. SYNTHETIC ONLY. It lives in the E1 package, outside apps/web: no app module imports it, it is not
 * part of any build, and it never reads, stores or sends anything but the fixture file it is given.
 *
 * It replays ONE confirmed synthetic scanner journey -- a fixture holding the PALM-03-I1 input the scanner's tracing
 * model produced (preview/fixtures/*.json, written by test/palm04I4FeatureToReading.test.ts) -- through the one E1
 * reading interface, generateSyntheticReading(input, { synthetic: true, mode }), and prints the reading as JSON or as
 * a self-contained HTML page (no scripts, no external resources, every value escaped).
 *
 *   npx ts-node packages/palm-reading-engine/e1/preview/render.ts <fixture.json> [--mode combined|indian-only|western-only]
 *                                                                [--format json|html] [--out <file>]
 *
 * Refuses (exit 2) anything that is not a synthetic scanner-journey fixture. Uncertain, unavailable, skipped and
 * not-requested features are shown exactly as E1 reports them (its notAssessed list); nothing is inferred.
 */
import * as fs from 'fs';
import { generateSyntheticReading, type ReadingMode } from '../src/reading';

export const PREVIEW_FIXTURE_KIND = 'palm-04-e1-preview-fixture@0.1.0';
export const PREVIEW_FIXTURE_SOURCE = 'synthetic-scanner-journey';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface PreviewFixture { kind: string; synthetic: true; source: string; scenario: string; description: string; input: Any }

export class PreviewError extends Error {}

/** Parse and check a fixture: only a synthetic scanner-journey fixture is ever replayed. */
export function readFixture(text: string): PreviewFixture {
  let f: Any;
  try { f = JSON.parse(text); } catch { throw new PreviewError('the fixture is not valid JSON'); }
  if (!f || typeof f !== 'object') throw new PreviewError('the fixture must be an object');
  if (f.kind !== PREVIEW_FIXTURE_KIND) throw new PreviewError(`the fixture kind must be ${PREVIEW_FIXTURE_KIND}`);
  if (f.synthetic !== true) throw new PreviewError('only synthetic fixtures can be previewed (synthetic must be exactly true)');
  if (f.source !== PREVIEW_FIXTURE_SOURCE) throw new PreviewError(`the fixture source must be ${PREVIEW_FIXTURE_SOURCE}`);
  if (typeof f.scenario !== 'string' || typeof f.description !== 'string' || !f.input || typeof f.input !== 'object') throw new PreviewError('the fixture needs scenario, description and input');
  return f as PreviewFixture;
}

/** The reading for one fixture, from the one E1 interface (which itself refuses anything not declared synthetic). */
export function previewReading(fixture: PreviewFixture, mode: ReadingMode = 'combined'): Any {
  return generateSyntheticReading(fixture.input, { synthetic: true, mode });
}

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A self-contained HTML page for a reading: no script, no external resource; every value escaped. */
export function renderHtml(fixture: PreviewFixture, reading: Any): string {
  const items = (reading.sections ?? []).flatMap((s: Any) => (s.items ?? []).map((it: Any) => `
    <article class="item"><p class="tag">${esc(it.traditionTag)} · ${esc(s.category)} · confidence ${esc(it.confidence)}</p>
      <p><strong>What you traced or we measured:</strong> ${esc(it.text?.observation)}</p>
      <p><strong>What the tradition says:</strong> ${esc(it.text?.reading)}</p>
      <p class="muted">${esc(it.text?.reflection)}</p></article>`)).join('');
  const notAssessed = (reading.notAssessed ?? []).map((n: Any) => `<li data-code="${esc(n.code)}"><strong>${esc(n.feature)}</strong>: ${esc(n.wording)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>E1 reading preview (synthetic)</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;background:#0b1020;color:#f8fafc}
.banner{background:#facc15;color:#0b1020;padding:8px 12px;border-radius:8px;font-weight:700}.item{border:1px solid #334155;border-radius:10px;padding:10px 12px;margin:10px 0}
.tag,.muted{color:#aab7d2;font-size:14px;margin:0}h1{font-size:22px}h2{font-size:18px;margin-top:24px}</style></head><body>
<p class="banner" data-testid="banner">SYNTHETIC INPUT · ${esc(reading.contentStatus)} · not for publication (publicationApproved: ${esc(reading.publicationApproved)})</p>
<h1>E1 reading preview</h1>
<p class="muted">Scenario: <span data-testid="scenario">${esc(fixture.scenario)}</span> — ${esc(fixture.description)} · engine ${esc(reading.engine?.id)} ${esc(reading.engine?.version)} · mode ${esc(reading.mode)}</p>
<p>${esc(reading.frame)}</p>
<p data-testid="quality">Photo check: ${reading.quality?.accepted ? 'accepted' : `not accepted (${esc(reading.quality?.detail)})`}</p>
<h2>Reading</h2>${items || '<p class="muted" data-testid="empty">No reading items for these features.</p>'}
<h2>Not assessed</h2><ul data-testid="not-assessed">${notAssessed}</ul>
</body></html>`;
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const mode = (opt('--mode') ?? 'combined') as ReadingMode;
  const format = opt('--format') ?? 'json';
  const out = opt('--out');
  if (!file) { process.stderr.write('usage: render.ts <fixture.json> [--mode m] [--format json|html] [--out file]\n'); return 2; }
  if (!['json', 'html'].includes(format)) { process.stderr.write('format must be json or html\n'); return 2; }
  let fixture: PreviewFixture;
  try { fixture = readFixture(fs.readFileSync(file, 'utf8')); } catch (e) { process.stderr.write(`refused: ${(e as Error).message}\n`); return 2; }
  const reading = previewReading(fixture, mode);
  const text = format === 'html' ? renderHtml(fixture, reading) : JSON.stringify(reading, null, 2);
  if (out) fs.writeFileSync(out, text); else process.stdout.write(text + '\n');
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
