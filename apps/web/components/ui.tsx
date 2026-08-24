'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

// ============================================================
// Modal (V2.1 section 8) -- every modal/sheet in the app previously
// reimplemented its own overlay/dialog chrome AND its own Escape/Tab-trap/
// body-scroll-lock/focus-restore behavior from scratch (confirmed:
// PastActivityModal and HomeDashboard's LogActivityModal duplicated
// ~90%-identical logic with slightly different z-index/radius/padding/
// close-affordance choices). useModalA11y owns the BEHAVIOR (each modal
// still picks its own initial-focus target, since that's the one thing
// that legitimately differs per modal); ModalShell owns the shared visual
// chrome (overlay, card, optional title/description header, optional close
// button, footer row) so title/description/content-spacing/close-action
// conventions can't drift apart again.
// ============================================================

/** Escape-to-close, Tab focus trap, body-scroll lock, and focus restore on
 * unmount -- the behavior every modal needs, extracted once instead of
 * reimplemented per component. `initialFocusRef` is optional so a modal
 * with no sensible first field (e.g. a confirm-only dialog) can omit it. */
export function useModalA11y({
  isOpen,
  onClose,
  dialogRef,
  initialFocusRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  dialogRef: React.RefObject<HTMLElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => initialFocusRef?.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, dialogRef]);
}

/** The one shared overlay+card shell every modal renders into via a portal.
 * `title`/`description` render the standardized header (with a close
 * button unless `onClose` is omitted for a no-dismiss confirm dialog);
 * `footer` is the standardized action row. Content spacing between header/
 * body/footer is fixed here so no modal has to guess its own gaps again. */
export function ModalShell({
  dialogRef,
  labelledBy,
  describedBy,
  title,
  description,
  onClose,
  maxWidth = 400,
  footer,
  children,
}: {
  dialogRef: React.RefObject<HTMLDivElement>;
  labelledBy: string;
  describedBy?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose?: () => void;
  maxWidth?: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // createPortal needs document.body, which doesn't exist during the
  // server render of this 'use client' component -- gate on mount so a
  // caller can render ModalShell unconditionally (e.g. `isOpen` defaulting
  // true, or true on the very first client render) without crashing SSR.
  const [mounted, setMounted] = React.useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: spacing.lg,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        style={{
          width: '100%',
          maxWidth,
          margin: 'min(6vh, 32px) 0',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: colors.surfaceSubtle,
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: radius.lg,
          padding: spacing.xxl,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
          color: colors.textPrimary,
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
          <div style={{ minWidth: 0 }}>
            <h2 id={labelledBy} style={typography.sectionTitle}>
              {title}
            </h2>
            {description && (
              <div id={describedBy} style={{ ...typography.meta, marginTop: spacing.xs }}>
                {description}
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 18, cursor: 'pointer', padding: spacing.xs, lineHeight: 1, flexShrink: 0 }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ marginTop: spacing.lg }}>{children}</div>

        {footer && <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.xxl }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// Form field primitives (V2.1 section 9) -- introduced only because real
// duplication justified it: PastActivityModal, PeopleView, and
// LocationPicker each hand-rolled their own label/input/select styling
// with slightly different heights, radii, and focus/error treatment. Not a
// general-purpose form library -- just label/input/select/hint/error,
// the five things that were actually duplicated.
// ============================================================

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', ...typography.sectionEyebrow, marginBottom: spacing.sm }}>
      {children}
    </label>
  );
}

const fieldInputBase: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 14px',
  borderRadius: radius.md,
  background: 'rgba(2, 6, 23, 0.4)',
  color: colors.textPrimary,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'var(--as-font-body)',
};

function fieldBorder(hasError?: boolean, active?: boolean): string {
  if (hasError) return `1px solid ${colors.danger}`;
  if (active) return `1px solid ${colors.accentBorder}`;
  return `1px solid ${colors.borderDefault}`;
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean; active?: boolean }>(
  ({ hasError, active, style, disabled, ...props }, ref) => (
    <input
      ref={ref}
      disabled={disabled}
      style={{ ...fieldInputBase, border: fieldBorder(hasError, active), opacity: disabled ? 0.55 : 1, ...style }}
      {...props}
    />
  )
);
TextInput.displayName = 'TextInput';

export const TextAreaInput = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { hasError?: boolean; active?: boolean }>(
  ({ hasError, active, style, disabled, ...props }, ref) => (
    <textarea
      ref={ref}
      disabled={disabled}
      style={{ ...fieldInputBase, minHeight: 74, padding: 12, border: fieldBorder(hasError, active), resize: 'vertical', opacity: disabled ? 0.55 : 1, ...style }}
      {...props}
    />
  )
);
TextAreaInput.displayName = 'TextAreaInput';

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }>(
  ({ hasError, style, disabled, children, ...props }, ref) => (
    <select
      ref={ref}
      disabled={disabled}
      style={{ ...fieldInputBase, border: fieldBorder(hasError), opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer', ...style }}
      {...props}
    >
      {children}
    </select>
  )
);
SelectInput.displayName = 'SelectInput';

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <div style={{ ...typography.caption, marginTop: spacing.xs }}>{children}</div>;
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return <div style={{ color: colors.danger, fontSize: 12, lineHeight: 1.4, marginTop: spacing.xs }}>{children}</div>;
}
