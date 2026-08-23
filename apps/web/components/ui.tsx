'use client';

import React from 'react';
import { colors, radius, spacing, typography } from './theme';

/**
 * Aura UI Experience V2 -- the shared component primitive set (brief
 * section 9). Deliberately small: every screen's PageHeader/card/button/
 * chip/badge/empty-state should come from here instead of a fresh
 * bespoke implementation, but this is NOT a general-purpose design-system
 * package -- it only contains the primitives the brief actually asked for,
 * built on top of theme.ts's tokens (colors/spacing/radius/typography).
 */

// ============================================================
// PageHeader -- one shared header pattern for every top-level screen
// (brief section 8): same title size, subtitle styling, vertical spacing,
// and right-action alignment everywhere.
// ============================================================

export function PageHeader({
  title,
  subtitle,
  rightAction,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  rightAction?: React.ReactNode;
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={typography.pageTitle}>{title}</h1>
        {subtitle && <p style={typography.pageSubtitle}>{subtitle}</p>}
      </div>
      {rightAction && <div style={{ flexShrink: 0 }}>{rightAction}</div>}
    </header>
  );
}

// ============================================================
// SectionHeader -- the small uppercase-monospace eyebrow label, optionally
// paired with a "See all →" style right-side TextButton.
// ============================================================

export function SectionHeader({
  label,
  color,
  right,
}: {
  label: string;
  color?: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.md }}>
      <h2 style={{ ...typography.sectionEyebrow, color: color ?? typography.sectionEyebrow.color }}>{label}</h2>
      {right}
    </div>
  );
}

// ============================================================
// SurfaceCard -- the default quiet card (brief section 10): subtle border,
// quiet surface, consistent radius/padding. `elevated` opts into the
// gradient/glow panel style for a genuinely current/selected state only.
// ============================================================

export function SurfaceCard({
  children,
  elevated = false,
  accentColor,
  padding = spacing.lg,
  style,
}: {
  children: React.ReactNode;
  elevated?: boolean;
  /** A soft accent border/glow for a genuinely current/selected card (e.g.
   * Starting Soon, the current-moment hero) -- never applied by default. */
  accentColor?: string;
  padding?: number;
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = elevated
    ? {
        background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
        border: `1px solid ${accentColor ? `${accentColor}45` : 'rgba(96, 165, 250, 0.18)'}`,
        borderRadius: radius.lg,
        boxShadow: accentColor ? `inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 32px -24px ${accentColor}40` : 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
        padding,
      }
    : {
        background: colors.surfaceSubtle,
        border: `1px solid ${accentColor ? `${accentColor}38` : colors.borderSubtle}`,
        borderRadius: radius.lg,
        padding,
      };
  return <div style={{ ...base, ...style }}>{children}</div>;
}

// ============================================================
// ResultCard -- Plan/Muhurtham result rows (brief section 33/41): a
// headline match label, a time, a short one-line context, a primary
// action, and an optional "Why this time? →" text link. Secondary results
// pass `recede` to visually step back.
// ============================================================

export function ResultCard({
  eyebrow,
  eyebrowColor,
  title,
  meta,
  description,
  primaryAction,
  secondaryAction,
  recede = false,
}: {
  eyebrow?: string;
  eyebrowColor?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  recede?: boolean;
}) {
  return (
    <SurfaceCard accentColor={recede ? undefined : eyebrowColor} style={recede ? { opacity: 0.72 } : undefined}>
      {eyebrow && <div style={{ ...typography.badgeText, color: eyebrowColor ?? colors.positive, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{eyebrow}</div>}
      <div style={{ ...typography.sectionTitle, marginTop: eyebrow ? spacing.sm : 0 }}>{title}</div>
      {meta && <div style={{ ...typography.meta, marginTop: spacing.xs, color: colors.textFaint }}>{meta}</div>}
      {description && <p style={{ ...typography.body, marginTop: spacing.sm }}>{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md }}>
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </SurfaceCard>
  );
}

// ============================================================
// ActionRow / SettingRow -- a compact single-line row (an Upcoming Plans
// entry, a You settings row). SettingRow adds a trailing value/chevron.
// ============================================================

export function ActionRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.md,
        width: '100%',
        padding: `${spacing.sm}px 0`,
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        minHeight: 44,
      }}
    >
      {icon && <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }} aria-hidden="true">{icon}</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={typography.bodyStrong}>{title}</div>
        {subtitle && <div style={{ ...typography.meta, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </Wrapper>
  );
}

export function SettingRow({
  icon,
  title,
  detail,
  value,
  onClick,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  value?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <ActionRow
      icon={icon}
      title={title}
      subtitle={detail}
      onClick={onClick}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, flexShrink: 0, color: colors.textMuted, fontSize: 12 }}>
          {value}
          {onClick && <ChevronIcon />}
        </div>
      }
    />
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============================================================
// Buttons (brief section 11) -- standardized height/radius/padding/font/
// disabled/loading. PrimaryButton/SecondaryButton/DestructiveButton share
// one base; TextButton and IconButton are visually distinct (no fill).
// ============================================================

const buttonBase: React.CSSProperties = {
  minHeight: 44,
  borderRadius: radius.md,
  padding: '0 18px',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing.xs,
  border: '1px solid transparent',
};

export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = 'button',
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={{
        ...buttonBase,
        background: colors.positive,
        color: colors.textInverse,
        opacity: disabled || loading ? 0.6 : 1,
        ...style,
      }}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        ...buttonBase,
        minHeight: 38,
        background: colors.positiveSoft,
        color: colors.positive,
        borderColor: colors.accentBorder,
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function TextButton({
  children,
  onClick,
  color,
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        border: 'none',
        background: 'transparent',
        color: color ?? colors.info,
        fontSize: 13,
        fontWeight: 850,
        cursor: 'pointer',
        padding: 0,
        minHeight: 32,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function DestructiveButton({
  children,
  onClick,
  disabled,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonBase,
        minHeight: 38,
        background: colors.dangerSoft,
        color: colors.danger,
        borderColor: 'rgba(251, 107, 107, 0.35)',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  ariaLabel,
  style,
  badge,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  style?: React.CSSProperties;
  /** Small overlaid count/dot -- e.g. the Bell's unread badge. */
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        border: `1px solid ${colors.borderSubtle}`,
        background: colors.surfaceSubtle,
        color: colors.textPrimary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
      {badge}
    </button>
  );
}

// ============================================================
// StatusBadge -- non-interactive meaning (brief section 12). Small pill,
// colored by semantic tone only.
// ============================================================

export type StatusTone = 'positive' | 'caution' | 'danger' | 'info' | 'relationship' | 'traditional' | 'neutral';

const toneColor: Record<StatusTone, string> = {
  positive: colors.positive,
  caution: colors.caution,
  danger: colors.danger,
  info: colors.info,
  relationship: colors.relationship,
  traditional: colors.traditional,
  neutral: colors.textMuted,
};

const toneSoft: Record<StatusTone, string> = {
  positive: colors.positiveSoft,
  caution: colors.cautionSoft,
  danger: colors.dangerSoft,
  info: colors.infoSoft,
  relationship: colors.relationshipSoft,
  traditional: colors.traditionalSoft,
  neutral: 'rgba(148, 163, 184, 0.12)',
};

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <span
      style={{
        ...typography.badgeText,
        display: 'inline-flex',
        alignItems: 'center',
        color: toneColor[tone],
        background: toneSoft[tone],
        border: `1px solid ${toneColor[tone]}40`,
        borderRadius: radius.pill,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ============================================================
// Chips -- three visually distinct families (brief section 12). Do not
// reuse one chip style for all three.
// ============================================================

/** Warm, selectable -- activity/occasion choices (Date Night, Coffee/Tea). */
export function ActivityChip({ label, icon, onClick, selected }: { label: string; icon?: string; onClick?: () => void; selected?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 38,
        padding: '0 14px',
        borderRadius: radius.pill,
        border: `1px solid ${selected ? colors.accentBorder : colors.borderSubtle}`,
        background: selected ? colors.positiveSoft : 'rgba(15, 23, 42, 0.6)',
        color: selected ? colors.positive : colors.textSecondary,
        fontSize: 13,
        fontWeight: 750,
        cursor: 'pointer',
      }}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </button>
  );
}

/** Compact choice -- duration pickers (30 min / 60 min / 90 min). */
export function DurationChip({ label, onClick, selected }: { label: string; onClick?: () => void; selected?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        minHeight: 40,
        padding: '0 14px',
        borderRadius: radius.md,
        border: `1px solid ${selected ? colors.accentBorder : colors.borderSubtle}`,
        background: selected ? colors.positiveSoft : 'rgba(15, 23, 42, 0.6)',
        color: selected ? colors.positive : colors.textSecondary,
        fontSize: 13,
        fontWeight: 800,
        cursor: 'pointer',
        flex: '1 1 auto',
      }}
    >
      {label}
    </button>
  );
}

/** One-of-many mode switch (Find/Check/Compare, General/Me/Us,
 * Calendar/Muhurtham) -- ONE shared implementation, never a fresh one-off
 * per screen (brief section 29/39/42). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 2,
        padding: 3,
        borderRadius: radius.md,
        background: 'rgba(2, 6, 23, 0.5)',
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: radius.sm,
              border: 'none',
              background: active ? colors.surfaceSelected : 'transparent',
              color: active ? colors.positive : colors.textMuted,
              fontSize: 13,
              fontWeight: active ? 850 : 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              padding: '0 8px',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// EmptyState -- one consistent pattern (brief section 67).
// ============================================================

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', padding: `${spacing.xxl}px ${spacing.lg}px` }}>
      <div style={{ ...typography.bodyStrong, color: colors.textSecondary }}>{title}</div>
      {description && <p style={{ ...typography.body, marginTop: spacing.xs, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}>{description}</p>}
      {action && <div style={{ marginTop: spacing.md }}>{action}</div>}
    </div>
  );
}
