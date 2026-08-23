import type { CSSProperties } from 'react';

/**
 * Shared visual theme -- the single source of truth for panel/card styling
 * and accent colors across every screen. Before this file existed, each
 * screen defined its own near-duplicate `cardStyle`/`backButtonStyle`/etc.
 * consts, and two visually distinct "families" had drifted apart: Plan and
 * Home used a gradient panel with a blue-tinted border, while every other
 * screen (Panchang, Muhurtham, People, Your Moments, You, Explore, Updates)
 * used a flat panel background instead. This file standardizes on Plan's
 * look -- the gradient panel -- as the one canonical style; every screen
 * now imports from here instead of defining its own variant.
 *
 * Aura UI Experience V2 -- extended with the fuller semantic system
 * (spacing/radius scale, typography primitives, quiet surface style) that
 * components/ui.tsx's shared primitives are built from. `colors` keeps its
 * original flat keys (still imported by name across many existing files)
 * and gains the new named semantic/soft pairs alongside them, rather than
 * being restructured into nested objects -- avoids a repo-wide rename for
 * a presentation-only pass. Reads the CSS custom properties in
 * app/tokens.css with the SAME literal fallback each var already had, so
 * nothing regresses if the stylesheet fails to load.
 */

export const colors = {
  accent: '#4ade80', // primary CTA / positive / supportive
  accentBorder: 'rgba(74, 222, 128, 0.35)',
  accentDim: 'rgba(74, 222, 128, 0.08)',
  info: '#38bdf8', // secondary / informational links
  danger: '#fb6b6b',
  dangerAlt: '#fb7185',
  warning: '#facc15',
  purple: '#a78bfa',
  textPrimary: '#f8fafc',
  textSecondary: '#dbe7f4',
  textMuted: '#94a3b8',
  textFaint: '#aab7d2',

  // Named semantic colors + "soft" (low-opacity fill, for badges/chips)
  // variants (brief section 2/6) -- one meaning per color, used
  // consistently instead of picking a fresh accent per screen.
  positive: '#4ade80',
  positiveSoft: 'rgba(74, 222, 128, 0.12)',
  caution: '#facc15',
  cautionSoft: 'rgba(250, 204, 21, 0.12)',
  dangerSoft: 'rgba(251, 107, 107, 0.12)',
  infoSoft: 'rgba(56, 189, 248, 0.12)',
  relationship: '#f472b6', // shared/relationship moments
  relationshipSoft: 'rgba(244, 114, 182, 0.12)',
  traditional: '#a78bfa', // Aura / planning / traditional-astrology accents
  traditionalSoft: 'rgba(167, 139, 250, 0.12)',

  borderSubtle: 'rgba(148, 163, 184, 0.14)',
  borderDefault: 'rgba(148, 163, 184, 0.22)',
  surfaceSubtle: 'rgba(255, 255, 255, 0.03)',
  surfaceSelected: 'rgba(74, 222, 128, 0.14)',
  textInverse: '#02150c',
};

/** Spacing scale (brief section 3) -- every page padding/section gap/card
 * padding/row gap should resolve to one of these instead of an arbitrary
 * pixel value. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
};

/** Radius scale (brief section 4). */
export const radius = {
  sm: 10,
  md: 12,
  lg: 16,
  pill: 999,
};

/** Typography primitives (brief section 5) -- named styles instead of a
 * fresh fontSize/fontWeight/color combination per heading. Uppercase
 * monospace is reserved for `sectionEyebrow` (short section labels like
 * GOOD RIGHT NOW / STARTING SOON) -- never applied to real headings, so
 * the app doesn't read like a terminal. */
export const typography: Record<string, CSSProperties> = {
  pageTitle: { margin: 0, fontSize: 26, lineHeight: 1.1, fontWeight: 900, color: colors.textPrimary, letterSpacing: 0 },
  pageSubtitle: { margin: '6px 0 0', fontSize: 14, lineHeight: 1.4, color: colors.textFaint },
  sectionTitle: { margin: 0, fontSize: 18, lineHeight: 1.25, fontWeight: 800, color: colors.textPrimary },
  sectionEyebrow: { margin: 0, fontFamily: 'var(--as-font-mono)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textFaint },
  cardTitle: { margin: 0, fontSize: 14, fontWeight: 800, color: colors.textPrimary },
  body: { margin: 0, fontSize: 14, lineHeight: 1.45, color: colors.textFaint },
  bodyStrong: { margin: 0, fontSize: 14, lineHeight: 1.4, fontWeight: 750, color: colors.textPrimary },
  meta: { margin: 0, fontSize: 12, lineHeight: 1.4, color: colors.textMuted },
  caption: { margin: 0, fontSize: 11, lineHeight: 1.35, color: colors.textMuted },
  badgeText: { margin: 0, fontSize: 10, fontWeight: 850, letterSpacing: '0.02em' },
};

/** The canonical card/panel background -- Plan's own gradient. Every screen
 * that previously had its own flat `cardStyle` now imports this. */
export const panelStyle: CSSProperties = {
  background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
  border: '1px solid rgba(96, 165, 250, 0.18)',
  borderRadius: 16,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
  padding: 16,
};

/** A quieter surface than panelStyle -- flat, one subtle border, no
 * gradient/glow (brief section 10: "use glow only for genuinely
 * selected/current states"). This is the DEFAULT card surface for Aura UI
 * Experience V2; panelStyle above remains available for the few spots that
 * still want the gradient (e.g. a genuinely current/selected state). */
export const surfaceCardStyle: CSSProperties = {
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radius.lg,
  padding: spacing.lg,
};

export const backButtonStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 17,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(15, 23, 42, 0.75)',
  color: colors.textPrimary,
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px',
  fontWeight: 800,
};

export const sectionKickerStyle: CSSProperties = {
  color: colors.accent,
  fontSize: 11,
  fontFamily: 'var(--as-font-mono)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export const errorBoxStyle: CSSProperties = {
  color: colors.danger,
  fontSize: 12,
  lineHeight: 1.45,
};

export const linkButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: colors.info,
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'none',
};

/** A small nested cell/row within a panel (a Panchang summary line, a
 * suggested-alternative row, etc). */
export const cellStyle: CSSProperties = {
  background: 'rgba(2, 6, 23, 0.4)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  borderRadius: 10,
  padding: '9px 11px',
};

/** A small outline button -- confirm/secondary actions. */
export const outlineButtonStyle: CSSProperties = {
  minHeight: 40,
  borderRadius: 12,
  border: `1px solid ${colors.accentBorder}`,
  background: colors.accentDim,
  color: colors.accent,
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};
