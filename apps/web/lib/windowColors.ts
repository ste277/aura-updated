import type { SolarWindowType } from '../../../packages/panchang/src/windows';

export const COLOR_BY_TYPE: Record<SolarWindowType, string> = {
  BRAHMA: 'var(--as-brahma-start)',
  ABHIJIT: 'var(--as-abhijit)',
  RAHU_KALAM: 'var(--as-rahu)',
  GULIKA: 'var(--as-gulika)',
  YAMA: 'var(--as-yama)',
  NEUTRAL: 'var(--as-neutral-arc)',
};
