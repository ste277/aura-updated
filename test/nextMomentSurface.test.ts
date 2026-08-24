import { getWindowTone, nextMomentSurfaceLabel } from '../apps/web/components/HomeDashboard';

/**
 * Product Journey / E2E Hardening V1 (brief section 18) -- a caution/
 * low-quality candidate must never be presented as "Next Best Moment".
 * Reuses the existing getWindowTone() quality classification (no new
 * astrology threshold) -- only the label/icon wording changes.
 *
 * Run via the JSX-enabled ts-node project (HomeDashboard.tsx is a .tsx
 * file):
 *   TS_NODE_PROJECT=<scratchpad>/tsconfig.test-jsx.json npx ts-node test/nextMomentSurface.test.ts
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Caution windows (Rahu Kalam / Yama / low score) never say "Best"
// ============================================================
{
  const cautionTone = getWindowTone(4.2, 'RAHU_KALAM');
  check('getWindowTone classifies Rahu Kalam as Caution (sanity check)', cautionTone.pill === 'Caution');
  const surface = nextMomentSurfaceLabel(cautionTone);
  check('A Caution-tone candidate is never labeled "Next Best Moment"', !surface.label.includes('Best'));
  check('A Caution-tone candidate uses neutral "Coming Up" wording', surface.label === 'Coming Up');
}
{
  const cautionTone = getWindowTone(2.0, 'YAMAGANDA');
  const surface = nextMomentSurfaceLabel(cautionTone);
  check('A low-score Yama window is also never labeled "Best"', !surface.label.includes('Best'));
}
{
  // A low raw score alone (< 4), even outside Rahu/Yama naming, still
  // classifies as Caution via getWindowTone's own existing rule.
  const cautionTone = getWindowTone(2.5, 'NEUTRAL');
  check('A low score under a non-Rahu/Yama name still classifies Caution (existing rule)', cautionTone.pill === 'Caution');
  const surface = nextMomentSurfaceLabel(cautionTone);
  check('That low-score candidate is also never labeled "Best"', !surface.label.includes('Best'));
}

// ============================================================
// Genuinely favorable candidates keep "Next Best Moment"
// ============================================================
{
  const strongTone = getWindowTone(8.5, 'ABHIJIT');
  check('getWindowTone classifies a strong Abhijit window favorably (sanity check)', strongTone.pill !== 'Caution');
  const surface = nextMomentSurfaceLabel(strongTone);
  check('A genuinely favorable candidate keeps "Next Best Moment"', surface.label === 'Next Best Moment');
}
{
  const goodTone = getWindowTone(6, 'GULIKA');
  const surface = nextMomentSurfaceLabel(goodTone);
  check('A Good Window candidate also keeps "Next Best Moment"', surface.label === 'Next Best Moment');
}

if (!allPassed) {
  console.error('\nSome Next Best Moment presentation checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL NEXT MOMENT SURFACE CHECKS PASSED');
}
