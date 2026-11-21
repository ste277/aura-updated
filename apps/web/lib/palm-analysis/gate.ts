/**
 * AURA-PALM-G5-I1 -- development-only gate for palm-image input.
 *
 * The image-input experience is reachable only when BOTH hold:
 *   1. the code runs under `next dev` (NODE_ENV === 'development'), and
 *   2. the developer explicitly opted in with
 *        NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT=g5-i1-dev
 *
 * This is the innermost of four layers (see 09_FEATURE_GATE_VERIFICATION.md):
 *   a. production builds swap the whole palm-guide view tree, including this
 *      module and every palm-scan component, for an empty stand-in (the
 *      build-level exclusion in apps/web) while the guide content is unapproved;
 *   b. page.tsx refuses the palm-guide tab in production (its runtime gate);
 *   c. this gate (UI renders nothing; the session refuses work);
 *   d. the MediaPipe model/runtime files exist only in a gitignored dev
 *      directory, so no deployed origin can serve them.
 * There is no URL route for the palm guide: the app is one page with a tab state.
 */
export const PALM_IMAGE_INPUT_FLAG = 'NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT';
export const PALM_IMAGE_INPUT_FLAG_VALUE = 'g5-i1-dev';

export function isPalmImageInputEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  flag: string | undefined = process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT
): boolean {
  return nodeEnv === 'development' && flag === PALM_IMAGE_INPUT_FLAG_VALUE;
}
