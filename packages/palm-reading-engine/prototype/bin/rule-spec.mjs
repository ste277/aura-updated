// G6-D0 (R1.3) — pure renderer for 03_INTERPRETATION_RULE_SPEC.md. Generated from src/rules.mjs and src/policy.mjs so
// spec and code cannot drift. R1.2 (R1.1-RV-04): renders the `axis` frame requirement and the G5-I1 rotation rule.
// Writes nothing; bin/render-rule-spec.mjs writes the file, and test/r1-2-hardening.test.mjs checks the content.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, RULESET_VERSION, TRADITIONAL_NAMES, DOMAIN_TITLES, provenanceFor, exclusionsFor } from '../src/rules.mjs';
import { THRESHOLDS, TIER_LEAD, UNCERTAINTY_NOTES, DECLINE_TEXT, ROTATION_ACCEPT_LIMIT_DEG, FRAME_SCALE_ISSUES, FRAME_ORIENTATION_ISSUES } from '../src/policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** One sentence per frame property, rendered from the same constants the engine uses. */
export const FRAME_TEXT = Object.freeze({
  scale: `scale (palm width from landmarks; landmarks present and no ${FRAME_SCALE_ISSUES.join(' / ')} issue)`,
  axis: `axis (finger-base→wrist axis; scale reliable, no ${FRAME_ORIENTATION_ISSUES.join(' / ')} issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than ${ROTATION_ACCEPT_LIMIT_DEG}° — exactly ${ROTATION_ACCEPT_LIMIT_DEG}° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond ${ROTATION_ACCEPT_LIMIT_DEG}° → rotation-out-of-range)`,
  direction: 'direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed)',
});

export function renderRuleSpec() {
const header = fs.readFileSync(path.join(here, 'rule-spec-preamble.md'), 'utf8');
const L = [header.trimEnd(), '', `## 4. Rule catalogue (generated from \`prototype/src/rules.mjs\`, ruleset ${RULESET_VERSION})`, ''];
const range = (v) => `${v.min === undefined ? '−∞' : v.min} ≤ value < ${v.max === undefined ? '+∞' : v.max}`;
for (const f of FAMILIES) {
  const p = provenanceFor(f);
  L.push(`### ${f.id} — ${DOMAIN_TITLES[f.domain]}`, '',
    `| Field | Specification |`, `|---|---|`,
    `| Required features | ${f.requires.map((r) => `\`${r}\` (traditional "${TRADITIONAL_NAMES[r]}")`).join(' + ')}, each with status \`ok\`. ${f.feature} |`,
    `| Traditional source / provenance | ${p.tradition}. ${p.correspondence} Source status: ${p.sourceStatus}. ${p.verificationRequired} Authored by ${p.authoredBy}; ${p.licenceStatus}; guide-derived: ${p.guideDerived}; review: ${p.reviewStatus}.${f.hypothesis ? ' **Hypothesis feature** (no annotated reference class).' : ''} |`,
    `| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap${f.hypothesis ? ', hypothesis cap 0.74' : ''}). ≥ ${THRESHOLDS.clear} → clear; ≥ ${THRESHOLDS.tentative} → tentative; below → declined.${f.hypothesis ? ' Never clear.' : ''} |`,
    `| Contradictory evidence | ${f.contradictedBy.toString().includes('null') && f.contradictedBy.toString().length < 20 ? 'Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family.' : `Crease-level conflicts decline the family. In-crease contradiction lowers the tier by one: \`${f.contradictedBy.toString().replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 220)}\``} |`,
    `| Frame dependency (R1-F4, R1.1-RV-05) | ${['direction', 'axis', 'scale'].map((k) => `${FRAME_TEXT[k]}: **${(k === 'axis' ? f.frame.axis || f.frame.direction : f.frame[k]) ? 'required' : 'not required'}**${k === 'axis' && !f.frame.axis && f.frame.direction ? ' (via direction)' : ''}`).join('; ')}. A required but unreliable frame property → declined (\`frame-unreliable\`, with \`frameReasons\`). Palm side unconfirmed → capped at tentative${f.frame.direction ? '; model-estimated handedness → capped at tentative' : ''}. |`,
    `| Endpoint roles (R1-F5) | ${Object.entries(f.endpoints).map(([k, v]) => `\`${k}\`: ${v.join(', ')}`).join('; ') || 'none'}${Object.keys(f.endpoints).length ? ' — ambiguous roles → declined (`geometry-ambiguous`).' : ''} |`,
    `| Optional observations (R1-F3) | ${f.observations ? `${Object.entries(f.observations).map(([k, v]) => `\`${k}\`: ${v.join(', ')}`).join('; ')} — unsupported by the detector → \`feature-unsupported\`; absent → \`feature-not-observed\`. \`gapsBridged\` is never read.` : 'none'} |`,
    `| Boundary handling | margin ±${f.margin}: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |`,
    `| Order-tie handling (R1.3) | ${f.tieValues ? 'Reads an order-summed length: on a 4-dp tie only readings selected in both point orders are kept; a claim made in one order only → abstain (quiet); a difference in ambiguity → tentative; identical selections → unchanged.' : 'Reads no order-summed value; not affected.'}${f.id === 'F-CENTRAL-LONGITUDINAL' ? ' A vertical MINOR crease whose centre lies in x ∈ [0.3, 0.7] in either order competes for conflict detection; it is identified only if it is the sole competitor and its centre lies in the range in both orders.' : ''} |`,
    `| Missing-data behaviour | Required crease missing / not observed → family declined: "${DECLINE_TEXT.missing}"${f.absentNote ? ` Plus: "${f.absentNote}"` : ''} No variant is selected and no meaning is drawn from absence. |`,
    `| Uncertainty wording | clear: "${TIER_LEAD.clear} …" + "${UNCERTAINTY_NOTES.clear}"; tentative: "${TIER_LEAD.tentative} …" + "${UNCERTAINTY_NOTES.tentative}" |`,
    `| Excluded deterministic claims | ${exclusionsFor(f).join('; ')} |`, '',
    '| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |', '|---|---|---|---|---|');
  for (const v of f.variants) L.push(`| \`${v.id}\` | ${range(v)} | ${v.observe ?? '— (no claim)'} | ${v.text ?? '— (no notable feature; nothing shown)'} | ${v.reflect ?? '—'} |`);
  L.push('');
}
return L.join('\n') + '\n';
}
