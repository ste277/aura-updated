/**
 * AURA-PREF-01 -- one place for how Aura points people at their availability
 * and work-hour settings (You tab), and the single, optional hint shown under
 * Find a Time results when a preference that would tailor them isn't set.
 * Pure: no fetch, no DOM.
 */

export const PREFERENCE_SECTION_IDS = {
  availability: 'availability-settings',
  workHours: 'work-hours-settings',
} as const;

export type PreferenceSection = keyof typeof PREFERENCE_SECTION_IDS;

/** Deep link into the existing You tab, scrolled to one settings card. */
export function preferenceSettingsHref(section: PreferenceSection): string {
  return `/?tab=you&section=${section === 'workHours' ? 'work-hours' : 'availability'}`;
}

/** The element id to scroll to for a `?section=` value, or null. */
export function preferenceSectionIdFromSearch(search: string): string | null {
  const section = new URLSearchParams(search).get('section');
  if (section === 'availability') return PREFERENCE_SECTION_IDS.availability;
  if (section === 'work-hours') return PREFERENCE_SECTION_IDS.workHours;
  return null;
}

export interface PreferenceHint {
  text: string;
  linkLabel: string;
  href: string;
}

/**
 * Find a Time: at most one short hint, only when results exist and a
 * preference that would tailor them is missing. Nothing when both are set.
 */
export function describeFindATimePreferenceHint(summary: { availability?: 'CONFIGURED' | 'UNCONFIGURED'; workHours?: 'CONFIGURED' | 'UNCONFIGURED' } | null | undefined): PreferenceHint | null {
  if (!summary) return null;
  const noAvailability = summary.availability === 'UNCONFIGURED';
  const noWorkHours = summary.workHours === 'UNCONFIGURED';
  if (noAvailability && noWorkHours) {
    return { text: 'These times consider your whole day.', linkLabel: 'Add your usual hours', href: preferenceSettingsHref('availability') };
  }
  if (noWorkHours) {
    return { text: 'Add your work hours to keep personal activities outside them.', linkLabel: 'Set work hours', href: preferenceSettingsHref('workHours') };
  }
  if (noAvailability) {
    return { text: 'These times can be early or late in the day.', linkLabel: 'Set your available hours', href: preferenceSettingsHref('availability') };
  }
  return null;
}
