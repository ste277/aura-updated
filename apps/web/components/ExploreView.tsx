'use client';

import React from 'react';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../../../packages/recommendation/src/muhurthamFinder';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import * as theme from './theme';
import { typography } from './theme';
import { PageHeader } from './ui';

/**
 * Product Structure V2 -- Explore owns Panchang + Muhurtham (brief section
 * 23). A small landing/discovery screen, not a rewrite of either existing
 * view: PanchangCalendarView and MuhurthamFinderView are unchanged, just
 * reached from here instead of buried under You. Deliberately does NOT mix
 * in "Your Moments" (brief section 23: "Do not mix Your Moments into this
 * screen" -- that lives in Plan).
 *
 * Redesigned for visual parity with the Home/Plan screens: two distinct
 * feature-destination cards (Panchang = "what does today hold", Muhurtham =
 * "when is a favorable time"), plus a Quick Explore grid of shortcuts into
 * Muhurtham Finder with an occasion preselected. The occasion list is never
 * a second catalog -- it's SUPPORTED_MUHURTHAM_ACTIVITY_IDS, the exact same
 * list Muhurtham Finder's own "What are you planning?" dropdown uses.
 */
interface ExploreViewProps {
  /** Used only to format the Panchang card's "Today · <date>" footer in the
   * owner's own timezone -- never a hardcoded date. */
  timezone: string;
  onOpenPanchang: () => void;
  onOpenMuhurtham: () => void;
  /** Quick Explore shortcuts: open Muhurtham Finder with this occasion
   * already selected (see MuhurthamFinderView's initialActivityId/Key). */
  onOpenMuhurthamWithActivity: (activityId: string) => void;
}

export function ExploreView({ timezone, onOpenPanchang, onOpenMuhurtham, onOpenMuhurthamWithActivity }: ExploreViewProps) {
  const todayLabel = new Date().toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });

  // Reuses the SAME occasion list Muhurtham Finder's own dropdown is built
  // from -- no duplicate catalog, and no invented occasions (there's no
  // "Marriage" entry in the real catalog, so it isn't offered here either).
  const quickOccasions = SUPPORTED_MUHURTHAM_ACTIVITY_IDS
    .map((id) => FULL_ACTIVITY_CATALOG.find((activity) => activity.id === id))
    .filter((activity): activity is NonNullable<typeof activity> => Boolean(activity));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24, fontFamily: 'sans-serif', color: theme.colors.textPrimary }}>
      <PageHeader
        title={<>Explore ✨</>}
        subtitle={<>Understand today.<br />Find the right day for something important.</>}
      />

      <ExploreFeatureCard
        kicker="Panchang Calendar"
        actionLabel="Explore the day"
        description="See Tithi, Nakshatra, Yoga, Karana and favorable & caution periods."
        icon="🗓️"
        accent={theme.colors.info}
        footerIcon="📅"
        footer={`Today · ${todayLabel}`}
        onClick={onOpenPanchang}
      />

      <ExploreFeatureCard
        kicker="Muhurtham Finder"
        actionLabel="Find an auspicious time"
        description="Choose an occasion and Aura will find favorable dates and times."
        icon="✨"
        accent={theme.colors.warning}
        footerIcon="✨"
        footer="Browse important occasions"
        onClick={onOpenMuhurtham}
      />

      <section>
        <div style={typography.sectionEyebrow}>Quick Explore</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
          {quickOccasions.map((activity) => (
            <button
              key={activity.id}
              type="button"
              onClick={() => onOpenMuhurthamWithActivity(activity.id)}
              style={quickOccasionStyle}
            >
              <span style={{ fontSize: 20 }} aria-hidden="true">{activity.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{activity.title}</span>
            </button>
          ))}
        </div>
      </section>

      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <button type="button" onClick={onOpenMuhurtham} style={viewAllStyle}>
          View all occasions →
        </button>
        <p style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 6, lineHeight: 1.4 }}>
          Aura supports important occasions and new beginnings.
        </p>
      </div>
    </div>
  );
}

function ExploreFeatureCard({
  kicker,
  actionLabel,
  description,
  icon,
  accent,
  footerIcon,
  footer,
  onClick,
}: {
  kicker: string;
  actionLabel: string;
  description: string;
  icon: string;
  accent: string;
  footerIcon: string;
  footer: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${kicker} — ${actionLabel}`}
      style={{
        ...theme.panelStyle,
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: `1px solid ${accent}45`,
        background: `linear-gradient(160deg, ${accent}14, rgba(13, 28, 62, 0.86))`,
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div
          style={{
            width: 60,
            height: 60,
            flexShrink: 0,
            borderRadius: 30,
            background: `${accent}1c`,
            border: `1px solid ${accent}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
          }}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: accent, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--as-font-mono)' }}>
            {kicker}
          </div>
          <div style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: 800, marginTop: 6, lineHeight: 1.25 }}>{actionLabel}</div>
          <p style={{ color: theme.colors.textFaint, fontSize: 13, lineHeight: 1.5, margin: '8px 0 0' }}>{description}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${accent}22` }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.colors.textFaint, minWidth: 0 }}>
          <span aria-hidden="true">{footerIcon}</span>
          {footer}
        </span>
        <span
          style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 17, border: `1px solid ${accent}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontSize: 15 }}
          aria-hidden="true"
        >
          →
        </span>
      </div>
    </button>
  );
}

const quickOccasionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 52,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: 14,
  background: 'rgba(2, 6, 23, 0.4)',
  color: theme.colors.textPrimary,
  padding: '12px 14px',
  cursor: 'pointer',
  textAlign: 'left',
};

const viewAllStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: theme.colors.info,
  fontSize: 15,
  fontWeight: 850,
  cursor: 'pointer',
  padding: 0,
};
