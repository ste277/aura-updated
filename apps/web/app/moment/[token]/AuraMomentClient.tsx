'use client';

import React, { useState } from 'react';
import type { PublicAuraMoment, PublicAuraMomentOutcome } from '../../../lib/auraMoments';
import { buildGoogleCalendarUrl } from '../../../../../packages/recommendation/src/dailyAssistant';
import { trackEvent } from '../../../lib/trackEvent';
import { colors, radius, spacing, typography } from '../../../components/theme';
import { PrimaryButton, TextButton, StatusBadge, EmptyState, type StatusTone } from '../../../components/ui';

interface AuraMomentClientProps {
  token: string;
  initialOutcome: PublicAuraMomentOutcome;
}

type AlternativePreference = 'EARLIER' | 'LATER' | 'DIFFERENT_DAY' | 'NO_PREFERENCE';

const RATING_TEXT_GENERAL: Record<string, string> = {
  EXCELLENT: 'Excellent fit',
  STRONG: 'Strong fit',
  FAVORABLE: 'Favorable',
  ACCEPTABLE: 'Acceptable',
};

const RATING_TEXT_SHARED: Record<string, string> = {
  EXCELLENT_SHARED_FIT: 'Excellent shared fit',
  STRONG_SHARED_FIT: 'Strong shared fit',
  GOOD_SHARED_FIT: 'Good shared fit',
  MIXED_SHARED_FIT: 'Mixed fit',
};

/** Section 3's four choices -- "Anything else" is the recipient-facing label
 * for NO_PREFERENCE, i.e. no specific preference at all. */
const PREFERENCE_OPTIONS: Array<{ value: AlternativePreference; label: string }> = [
  { value: 'EARLIER', label: 'Earlier' },
  { value: 'LATER', label: 'Later' },
  { value: 'DIFFERENT_DAY', label: 'Different day' },
  { value: 'NO_PREFERENCE', label: 'Anything else' },
];

/** The confirmation clause per preference (V2.1 section 3: "We'll let
 * Stephen know another time works better."). NO_PREFERENCE gets the exact
 * brief wording; the others keep the specific preference the recipient
 * picked rather than flattening every case to the same generic sentence. */
const PREFERENCE_CONFIRMATION_CLAUSE: Record<AlternativePreference, string> = {
  EARLIER: "you'd prefer something earlier",
  LATER: "you'd prefer something later",
  DIFFERENT_DAY: "you'd prefer a different day",
  NO_PREFERENCE: 'another time works better',
};

function ratingDisplayText(ratingLabel: string | null, scope: string): string | null {
  if (!ratingLabel) return null;
  return (scope === 'SHARED' ? RATING_TEXT_SHARED[ratingLabel] : RATING_TEXT_GENERAL[ratingLabel]) ?? null;
}

function ratingTone(scope: string): StatusTone {
  return scope === 'SHARED' ? 'relationship' : 'positive';
}

function formatMomentTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

/** "Saturday · 7:30–9:00 PM", substituting Today/Tomorrow when the moment
 * falls on one of those relative days (brief section 18: reuse the app's
 * relative-day convention -- "Tomorrow · 7:30 PM" / "Saturday · 7:30 PM" --
 * rather than a raw weekday+date or an ISO string). Local to this file, the
 * same way PlanWithAuraView's own formatPlanDay is local to that screen. */
function formatMomentWhen(startAtIso: string, endAtIso: string, timezone: string): string {
  const start = new Date(startAtIso);
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startKey = keyFmt.format(start);
  let dayLabel = dayFmt.format(start);
  if (startKey === keyFmt.format(now)) dayLabel = 'Today';
  else if (startKey === keyFmt.format(tomorrow)) dayLabel = 'Tomorrow';
  return `${dayLabel} · ${formatMomentTime(startAtIso, timezone)}–${formatMomentTime(endAtIso, timezone)}`;
}

/**
 * Product Structure V2 (brief section 18): moment copy must be
 * source-neutral AND never use ceremonial "Muhurtham" framing for an
 * EVERYDAY activity (Date Night, Coffee, Birthday Party, ...) -- only
 * CEREMONIAL/IMPORTANT activities (Griha Pravesh, an important journey, a
 * financial decision) keep the existing heart-emoji "shared moment"
 * framing. Driven by moment.planningMode, which is derived from the
 * (public) activity catalog server-side -- never from AuraMomentSource, so
 * a Griha Pravesh Moment created via Plan still gets ceremonial framing.
 * UNCHANGED in V2.1 -- this pass only restyles how the result is presented.
 */
function momentKickerText(moment: PublicAuraMoment): string {
  if (moment.planningMode === 'EVERYDAY') return moment.sharedPersonDisplayName ? 'A moment together' : 'A moment from Aura';
  return moment.scope === 'SHARED' ? '❤️ A shared moment' : '✨ A moment from Aura';
}

/** Falls back to a short source-neutral sentence when the server-templated
 * explanationSnapshot is absent -- never a client-generated astrology
 * explanation (brief section 23: no Panchang/Muhurta computation here). */
function momentBodyText(moment: PublicAuraMoment): string {
  if (moment.explanationSnapshot) return moment.explanationSnapshot;
  const sender = moment.senderDisplayName ?? 'Someone';
  return moment.sharedPersonDisplayName ? `${sender} found a good moment for you both.` : `${sender} found a good moment for you.`;
}

function acceptCtaText(moment: PublicAuraMoment): string {
  return moment.planningMode === 'EVERYDAY' ? "I'm in" : "I'm in ❤️";
}

export function AuraMomentClient({ token, initialOutcome }: AuraMomentClientProps) {
  const [outcome, setOutcome] = useState<PublicAuraMomentOutcome>(initialOutcome);
  const [responding, setResponding] = useState<'ACCEPTED' | AlternativePreference | null>(null);
  const [error, setError] = useState('');
  // Clicking "Another time" only reveals the preference choices -- it does
  // NOT submit anything by itself (brief section 3). The actual POST fires
  // once a specific preference (including "Anything else") is picked.
  const [showPreferenceChoices, setShowPreferenceChoices] = useState(false);

  const respond = async (response: 'ACCEPTED' | 'ANOTHER_TIME', preference?: AlternativePreference) => {
    setResponding(response === 'ACCEPTED' ? 'ACCEPTED' : preference ?? null);
    setError('');
    try {
      const res = await fetch(`/api/aura-moments/${token}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preference ? { response, preference } : { response }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to send your response.');
      setOutcome({ status: 'OK', moment: data as PublicAuraMoment });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send your response.');
    } finally {
      setResponding(null);
    }
  };

  if (outcome.status !== 'OK') {
    return (
      <Shell>
        {/* Section 4: never reveal whether this was specifically REVOKED,
            EXPIRED, or NOT_FOUND -- one shared, generic EmptyState for all
            three (preserves the existing privacy behavior). */}
        <EmptyState
          title="This moment is no longer available."
          description="The invitation may have expired or been updated."
          action={<FindYourOwnMomentLink momentToken={token} />}
        />
      </Shell>
    );
  }

  const { moment } = outcome;
  const ratingText = ratingDisplayText(moment.ratingLabel, moment.scope);
  const calendarUrl = buildGoogleCalendarUrl(moment.activityTitle, moment.startAt, moment.endAt);
  const sender = moment.senderDisplayName ?? 'They';
  const tint = moment.scope === 'SHARED' ? colors.relationshipSoft : colors.traditionalSoft;
  const tintBorder = moment.scope === 'SHARED' ? colors.relationship : colors.traditional;

  return (
    <Shell>
      <div
        style={{
          background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
          border: `1px solid ${tintBorder}33`,
          borderRadius: radius.lg,
          padding: spacing.xxl,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 20px 40px -28px ${tintBorder}55`,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ ...typography.sectionEyebrow, color: colors.textMuted }}>AURA MOMENT</div>
          <div style={{ marginTop: spacing.md, fontSize: 14, fontWeight: 800, color: tintBorder }}>{momentKickerText(moment)}</div>

          <div
            style={{
              width: 68,
              height: 68,
              margin: `${spacing.lg}px auto 0`,
              borderRadius: radius.pill,
              background: tint,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
            }}
            aria-hidden="true"
          >
            {moment.activityIcon ?? '✨'}
          </div>

          <h1 style={{ ...typography.pageTitle, fontSize: 22, marginTop: spacing.lg }}>{moment.activityTitle}</h1>
          <div style={{ ...typography.bodyStrong, marginTop: spacing.sm }}>{formatMomentWhen(moment.startAt, moment.endAt, moment.timezone)}</div>

          {ratingText && (
            <div style={{ marginTop: spacing.md }}>
              <StatusBadge label={ratingText} tone={ratingTone(moment.scope)} />
            </div>
          )}

          <p style={{ ...typography.body, marginTop: spacing.lg, lineHeight: 1.6 }}>{momentBodyText(moment)}</p>
        </div>

        <div style={{ borderTop: `1px solid ${colors.borderSubtle}`, marginTop: spacing.xxl, paddingTop: spacing.xl }}>
          {moment.responseState === 'ACCEPTED' ? (
            <ResponseResult
              text={`✓ ${sender} will know you're in.`}
              action={
                <AnchorButton href={calendarUrl} target="_blank" rel="noreferrer">
                  Add to calendar
                </AnchorButton>
              }
              conversionPrompt="Want to find a good moment for something of your own?"
              momentToken={token}
            />
          ) : moment.responseState === 'ANOTHER_TIME' ? (
            <ResponseResult
              text={`✓ We'll let ${sender} know ${PREFERENCE_CONFIRMATION_CLAUSE[moment.responsePreference ?? 'NO_PREFERENCE']}.`}
              note={moment.hasSuccessor ? `✨ ${sender} has suggested a new time -- look out for a new link.` : undefined}
              conversionPrompt="Aura can also help you find good times for your own plans."
              momentToken={token}
            />
          ) : showPreferenceChoices ? (
            <>
              <div style={{ textAlign: 'center', ...typography.meta, marginBottom: spacing.lg }}>When would work better?</div>
              {error && <div style={{ color: colors.danger, fontSize: 12, textAlign: 'center', marginBottom: spacing.md }}>{error}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
                {PREFERENCE_OPTIONS.map((option) => (
                  <PreferenceChip
                    key={option.value}
                    label={responding === option.value ? 'Sending…' : option.label}
                    onClick={() => respond('ANOTHER_TIME', option.value)}
                    disabled={responding !== null}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', ...typography.meta, marginBottom: spacing.lg }}>Does this work for you?</div>
              {error && <div style={{ color: colors.danger, fontSize: 12, textAlign: 'center', marginBottom: spacing.md }}>{error}</div>}
              <PrimaryButton onClick={() => respond('ACCEPTED')} disabled={responding !== null} style={{ width: '100%', minHeight: 50 }}>
                {responding === 'ACCEPTED' ? 'Sending…' : acceptCtaText(moment)}
              </PrimaryButton>
              <div style={{ textAlign: 'center', marginTop: spacing.md }}>
                <TextButton onClick={() => setShowPreferenceChoices(true)} color={colors.textMuted}>
                  Another time
                </TextButton>
              </div>
            </>
          )}
        </div>
      </div>

      <FindYourOwnMomentFooter momentToken={token} senderDisplayName={moment.senderDisplayName} />
    </Shell>
  );
}

function ResponseResult({
  text,
  note,
  action,
  conversionPrompt,
  momentToken,
}: {
  text: string;
  note?: string;
  action?: React.ReactNode;
  /** Recipient Conversion V1 (brief section 12/13): the acquisition CTA
   * only gets to be this prominent AFTER the recipient has responded --
   * never competing with I'm in / Another time above. Copy differs by
   * response (see the two call sites), the CTA itself is the same link. */
  conversionPrompt?: string;
  momentToken: string;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ ...typography.bodyStrong, fontSize: 15 }}>{text}</div>
      {note && <p style={{ color: colors.traditional, fontSize: 13, marginTop: spacing.sm, fontWeight: 700 }}>{note}</p>}
      {action && <div style={{ marginTop: spacing.lg }}>{action}</div>}
      {conversionPrompt && (
        <div style={{ marginTop: spacing.xxl, paddingTop: spacing.xl, borderTop: `1px solid ${colors.borderSubtle}` }}>
          <p style={{ ...typography.body, marginBottom: spacing.md }}>{conversionPrompt}</p>
          <FindYourOwnMomentLink momentToken={momentToken} />
        </div>
      )}
    </div>
  );
}

function PreferenceChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 44,
        padding: '0 14px',
        borderRadius: radius.md,
        border: `1px solid ${colors.borderSubtle}`,
        background: 'rgba(15, 23, 42, 0.5)',
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** The acquisition loop (brief section 18, extended by Recipient
 * Conversion V1) -- routes to the guest conversion flow at /find, never the
 * raw Moment token itself (privacy -- brief section 11/19: attribution
 * stays product-level via ?src=moment, never a sender/Moment identity).
 * trackEvent's own `momentToken` option is a SEPARATE, already-safe
 * mechanism (resolved server-side to an internal id for analytics
 * correlation, never stored as the token itself -- see
 * api/product-events/route.ts), unrelated to what rides in the URL here. */
function FindYourOwnMomentLink({ momentToken }: { momentToken: string }) {
  return (
    <AnchorButton href="/find?src=moment" onClick={() => trackEvent('AURA_MOMENT_FIND_YOUR_OWN_CLICKED', { momentToken })}>
      Find your own moment →
    </AnchorButton>
  );
}

/** A link that reads as the SecondaryButton visual (brief calls for
 * "Add to calendar" / "Find your own moment" to look like real actions),
 * without nesting a real <button> inside an <a> -- invalid HTML and a
 * hydration/accessibility hazard the previous version of this component
 * didn't have either (it used a plain styled <a>, never a nested button). */
function AnchorButton({
  href,
  children,
  target,
  rel,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  target?: string;
  rel?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 38,
        padding: '0 18px',
        borderRadius: radius.md,
        border: `1px solid ${colors.accentBorder}`,
        background: colors.positiveSoft,
        color: colors.positive,
        fontSize: 13,
        fontWeight: 850,
        textDecoration: 'none',
      }}
    >
      {children}
    </a>
  );
}

function FindYourOwnMomentFooter({ momentToken, senderDisplayName }: { momentToken: string; senderDisplayName: string | null }) {
  return (
    <div style={{ textAlign: 'center', marginTop: spacing.xxl, paddingTop: spacing.xl, borderTop: `1px solid ${colors.borderSubtle}` }}>
      {senderDisplayName && <div style={{ ...typography.caption, marginBottom: spacing.sm }}>Sent by {senderDisplayName}</div>}
      <a
        href="/find?src=moment"
        onClick={() => trackEvent('AURA_MOMENT_FIND_YOUR_OWN_CLICKED', { momentToken })}
        style={{ color: colors.info, fontSize: 13, fontWeight: 800, textDecoration: 'none' }}
      >
        Find your own moment →
      </a>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--as-bg)',
        color: colors.textPrimary,
        fontFamily: 'var(--as-font-body)',
        display: 'flex',
        justifyContent: 'center',
        padding: `${spacing.xxxl}px ${spacing.lg}px`,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>{children}</div>
    </div>
  );
}
