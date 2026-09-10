/**
 * Personal Guidance Orchestration V1 -- the personal-intelligence pipeline.
 *
 * Pure glue between already-built, already-merged engines -- this file
 * performs NO astrology calculation of its own (no ephemeris math, no
 * Lahiri ayanamsa, no duplicated Dasha/transit/theme logic). Every real
 * calculation is delegated to its own canonical package; this function
 * only threads one stage's already-computed output into the next stage's
 * documented input shape, reusing the SAME natal chart
 * (packages/vedic/src/natalChart.ts's getNatalChart()) that
 * apps/web/lib/natalContext.ts already computes for the narrower
 * PersonalMuhurtaContext -- never a second, duplicate natal chart
 * computation.
 *
 * Chain (every function below is a real, already-exported engine
 * function -- verified fresh against each package's own index.ts during
 * this PR's own architecture audit):
 *
 *   getNatalChart(birthMomentUTC)                          packages/vedic
 *     -> fromGrahaPositions(...) -> buildBhriguNatalGraph(...)   packages/bhrigu
 *     -> deriveThemeContext(bhriguResult)                        packages/personal-themes
 *
 *   calculateVimshottariFromNatalChart(birthMomentUTC, natalPositions)  packages/vimshottari
 *     -> toLifePeriodContext(result, now)
 *
 *   calculateTransitActivationFromPositions(natalPositions, transitPositions, now)  packages/transit-activation
 *     -> toTransitActivationContext(result)
 *
 *   deriveLifeWeather({ natalThemes, lifePeriod, transitActivations, evaluationTime })  packages/life-weather
 *   deriveDailyPersonalFit({ lifeWeather })                    packages/daily-personal-fit
 *
 * Ashtakavarga is deliberately NOT wired here -- it is not part of Life
 * Weather or Daily Personal Fit's own input today (see #104's own
 * architecture audit); do not add it just because the package exists.
 */
import { getNatalChart } from '../../../packages/vedic/src/natalChart';
import { fromGrahaPositions } from '../../../packages/bhrigu/src/normalize';
import { buildBhriguNatalGraph } from '../../../packages/bhrigu/src/graph';
import { deriveThemeContext } from '../../../packages/personal-themes/src/engine';
import { calculateVimshottariFromNatalChart, toLifePeriodContext } from '../../../packages/vimshottari/src/engine';
import { calculateTransitActivationFromPositions, toTransitActivationContext } from '../../../packages/transit-activation/src/adapter';
import { deriveLifeWeather } from '../../../packages/life-weather/src/engine';
import { deriveDailyPersonalFit } from '../../../packages/daily-personal-fit/src/engine';
import { localDateTimeToUTC } from './timezone';
import type { DailyPersonalFitContext } from '../../../packages/personal-intelligence/src/context';
import type { User } from './db';

/**
 * Builds a `DailyPersonalFitContext` for `user` at `now`, or `undefined`
 * when the user's birth profile is incomplete -- never throws for a
 * missing profile (mirrors buildPersonalMuhurtaContextForUser's own
 * existing contract, apps/web/lib/natalContext.ts). `now` is the caller's
 * own single explicit evaluation instant -- this function never calls
 * `Date.now()`/`new Date()` itself.
 */
export function buildDailyPersonalFitForUser(user: User, now: Date): DailyPersonalFitContext | undefined {
  if (!user.birthDate || !user.birthTime || !user.birthTimezone) return undefined;

  const birthDateStr = user.birthDate.toISOString().split('T')[0];
  const birthMomentUTC = localDateTimeToUTC(birthDateStr, user.birthTime, user.birthTimezone);

  const natalPositions = getNatalChart(birthMomentUTC);
  const bhriguResult = buildBhriguNatalGraph(fromGrahaPositions(natalPositions));
  const themeContext = deriveThemeContext(bhriguResult);

  const vimshottariResult = calculateVimshottariFromNatalChart(birthMomentUTC, natalPositions);
  const lifePeriodContext = toLifePeriodContext(vimshottariResult, now);

  const transitPositions = getNatalChart(now);
  const transitResult = calculateTransitActivationFromPositions(natalPositions, transitPositions, now);
  const transitContext = toTransitActivationContext(transitResult);

  const lifeWeatherContext = deriveLifeWeather({
    natalThemes: themeContext,
    lifePeriod: lifePeriodContext,
    transitActivations: transitContext,
    evaluationTime: now.toISOString(),
  });

  return deriveDailyPersonalFit({ lifeWeather: lifeWeatherContext });
}
