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
