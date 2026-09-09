/**
 * Personal Intelligence Contract V1 -- personal theme taxonomy.
 *
 * PersonalTheme itself is defined in types.ts (see that file's own doc
 * comment for why it is a genuinely new taxonomy, distinct from the
 * existing ActivityCategory/MuhurtaFamily classifications). This file
 * holds the canonical, ordered enumeration of that taxonomy and the one
 * small pure helper derived from it.
 */
import type { PersonalTheme } from './types';

/**
 * The complete V1 personal theme set, in a fixed canonical order. Any
 * future code that needs to iterate "every personal theme" (a themes
 * dashboard, a completeness check, a test) should iterate THIS array
 * rather than re-deriving the set from the PersonalTheme union type
 * (which has no runtime representation on its own) or relying on any
 * object's own key-iteration order. isPersonalTheme (the runtime guard
 * derived from this array) lives in validation.ts alongside this
 * package's other structural guards.
 */
export const PERSONAL_THEMES: readonly PersonalTheme[] = [
  'FOCUS',
  'LEARNING',
  'CAREER',
  'FINANCE',
  'RELATIONSHIPS',
  'CREATIVITY',
  'SOCIAL',
  'WELLBEING',
  'EXPLORATION',
  'SPIRITUALITY',
];
