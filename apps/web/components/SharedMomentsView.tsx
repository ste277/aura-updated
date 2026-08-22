'use client';

import React, { useEffect, useState } from 'react';
import * as theme from './theme';

/**
 * Owner-facing moment management (Aura Moment Sharing brief section 14,
 * extended by Aura Moment Rescheduling) -- list what's been shared, see the
 * recipient's response and reschedule preference, copy/open the link,
 * revoke, and (for a SHARED moment the recipient asked to reschedule) find
 * and suggest an alternative. Lives under You (no new bottom-nav tab). No
 * real-time updates: a normal fetch on mount/after an action is sufficient.
 */

type AlternativePreference = 'EARLIER' | 'LATER' | 'DIFFERENT_DAY' | 'NO_PREFERENCE';

interface SharedMomentRow {
  id: string;
  publicToken: string;
  shareUrl: string;
  scope: 'GENERAL' | 'PERSONAL' | 'SHARED';
  source: 'PLAN' | 'MUHURTHAM';
  /** Derived server-side (never stored) -- picks everyday vs. ceremonial
   * copy for this moment's alternatives, the same field the public DTO
   * already carries. */
  planningMode: 'EVERYDAY' | 'IMPORTANT' | 'CEREMONIAL';
  activityTitle: string;
  activityIcon: string | null;
  startAt: string;
  timezone: string;
  sharedPersonDisplayName: string | null;
  status: 'ACTIVE' | 'REVOKED';
  responseState: 'ACCEPTED' | 'ANOTHER_TIME' | null;
  responsePreference: AlternativePreference | null;
  /** Whether a successor moment already exists via previousMomentId lineage
   * -- an ANOTHER_TIME response with hasSuccessor is already resolved, so
   * the "Find another time" CTA shouldn't offer to redo it. */
  hasSuccessor: boolean;
}

interface AlternativeCandidate {
  date: string;
  startAt: string;
  endAt: string;
  ratingLabel: string;
}

type AlternativesOutcome =
  | { status: 'OK'; candidates: AlternativeCandidate[] }
  | { status: 'NOT_APPLICABLE' }
  | { status: 'USER_PROFILE_INCOMPLETE' }
  | { status: 'SAVED_PERSON_PROFILE_INCOMPLETE' };

interface SharedMomentsViewProps {
  /** Omit when embedded === true (no back button is rendered). */
  onBack?: () => void;
  /** Aura Updates V1 -- called after "View" or "Find another time" marks a
   * moment's response seen, so the caller (page.tsx) can refetch the unread
   * badge without this view needing to know anything about that state
   * itself. */
  onSeen?: () => void;
  /** When arriving here via a Home "Find another time" card, jump straight
   * into that moment's alternatives (brief section 12: enter the EXISTING
   * flow, not a second one) rather than leaving the owner to find the right
   * card themselves. */
  focusMomentToken?: string;
  /** Product Structure V2 (brief section 19) -- true when rendered inline
   * at the bottom of Plan rather than as its own full-screen destination:
   * hides the back button and full-page header, keeping just the list and
   * a lighter heading. The data/actions are otherwise identical -- this is
   * a presentation-only flag, not a second implementation. */
  embedded?: boolean;
}

const PREFERENCE_TEXT: Record<AlternativePreference, string> = {
  EARLIER: 'Earlier',
  LATER: 'Later',
  DIFFERENT_DAY: 'A different day',
  NO_PREFERENCE: 'Anything else',
};

/** Every rating vocabulary an alternative candidate can carry, regardless
 * of which source/scope strategy produced it (Muhurtham SHARED, everyday
 * shared timing, or plain Timing Search for GENERAL/PERSONAL). One shared
 * lookup so the alternatives list never has to know which engine ran. */
const RATING_TEXT: Record<string, string> = {
  // Muhurtham SHARED (findSharedMuhurthams)
  EXCELLENT_SHARED_FIT: 'Excellent shared fit',
  STRONG_SHARED_FIT: 'Strong shared fit',
  GOOD_SHARED_FIT: 'Good shared fit',
  MIXED_SHARED_FIT: 'Mixed fit',
  // Everyday shared timing (findEverydaySharedTiming)
  STRONG_TOGETHER_FIT: 'Strong shared fit',
  GOOD_TOGETHER_FIT: 'Good shared fit',
  EASY_TOGETHER_FIT: 'Easy fit together',
  // Plain Timing Search (GENERAL/PERSONAL PLAN alternatives)
  EXCELLENT: 'Excellent fit',
  VERY_GOOD: 'Very good fit',
  GOOD: 'Good fit',
  USABLE: 'Usable',
  CAUTION: 'Use caution',
};

function formatMomentDateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric' });
}

function formatMomentTimeRange(startIso: string, endIso: string, timezone: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function responseText(moment: SharedMomentRow): { text: string; color: string } {
  if (moment.status === 'REVOKED') return { text: 'Revoked', color: '#64748b' };
  if (moment.responseState === 'ACCEPTED') return { text: "❤️ They're in", color: '#4ade80' };
  if (moment.responseState === 'ANOTHER_TIME') {
    return moment.hasSuccessor
      ? { text: '✓ Alternative suggested', color: '#4ade80' }
      : { text: '↻ Another time requested', color: '#facc15' };
  }
  return { text: 'Waiting for response', color: '#94a3b8' };
}

export function SharedMomentsView({ onBack, onSeen, focusMomentToken, embedded }: SharedMomentsViewProps) {
  const [moments, setMoments] = useState<SharedMomentRow[] | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Revoked moments are dead history -- collapsed by default so the list
  // doesn't just keep growing as more get revoked over time. Active moments
  // always show in full (there's rarely more than a handful at once).
  const [showRevoked, setShowRevoked] = useState(false);

  const loadMoments = async () => {
    setError('');
    try {
      const res = await fetch('/api/aura-moments');
      if (!res.ok) throw new Error('Unable to load shared moments.');
      setMoments(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shared moments.');
      setMoments([]);
    }
  };

  useEffect(() => {
    loadMoments();
  }, []);

  /** Section 6/10: marks ONE moment's response seen via the owner-authenticated
   * endpoint (never the public bearer-link response route). Best-effort --
   * a failure here shouldn't block the action (View/Find another time) the
   * owner actually asked for. Also called again after a successor is
   * suggested (redundant POST, harmless) purely for its onSeen?.() side
   * effect -- that's what tells Home to refetch, since only then does
   * hasSuccessor flip and the update stop requiring action. */
  const markSeen = (publicToken: string) => {
    fetch(`/api/aura-moments/${publicToken}/seen`, { method: 'POST' }).catch(() => {});
    onSeen?.();
  };

  const handleView = (moment: SharedMomentRow) => {
    window.open(moment.shareUrl, '_blank', 'noopener,noreferrer');
    markSeen(moment.publicToken);
  };

  const handleCopy = async (moment: SharedMomentRow) => {
    try {
      await navigator.clipboard.writeText(moment.shareUrl);
      setCopiedId(moment.id);
      setTimeout(() => setCopiedId((current) => (current === moment.id ? null : current)), 2000);
    } catch {
      // Clipboard access can fail (permissions/insecure context) -- non-fatal.
    }
  };

  const handleRevoke = async (moment: SharedMomentRow) => {
    setRevokingId(moment.id);
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to revoke this moment.');
      await loadMoments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke this moment.');
    } finally {
      setRevokingId(null);
      setConfirmingRevokeId(null);
    }
  };

  /** Permanently removes an already-revoked moment (brief: "how do we
   * remove completed Moments"). Scoped server-side to REVOKED only. */
  const handleDelete = async (moment: SharedMomentRow) => {
    setDeletingId(moment.id);
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to remove this moment.');
      setMoments((current) => current?.filter((m) => m.id !== moment.id) ?? current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove this moment.');
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {!embedded && onBack && (
          <button type="button" onClick={onBack} aria-label="Back" style={backButtonStyle}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            Back
          </button>
        )}
        <div>
          {/* Section 20: "Shared Moments" -> "Your Moments" -- the concept is
           * now universal (Plan and Muhurtham both create AuraMoments), not
           * specific to sharing with a partner. */}
          <h1 style={{ fontSize: embedded ? 16 : 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Your Moments</h1>
          {!embedded && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Moments you&apos;ve created and their responses.</p>}
        </div>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {moments === null ? (
        <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</p>
      ) : moments.length === 0 ? (
        <section style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>No Moments yet</div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            Tap &quot;Make this a Moment&quot; on a result in Plan, or &quot;Share this moment&quot; in Explore &rarr; Muhurtham, to create one.
          </p>
        </section>
      ) : (
        (() => {
          const activeMoments = moments.filter((m) => m.status === 'ACTIVE');
          const revokedMoments = moments.filter((m) => m.status === 'REVOKED');
          return (
            <>
              {activeMoments.length === 0 && revokedMoments.length > 0 && (
                <p style={{ fontSize: 13, color: '#94a3b8' }}>No active Moments -- see revoked below.</p>
              )}
              {activeMoments.map((moment) => (
                <MomentCard
                  key={moment.id}
                  moment={moment}
                  copied={copiedId === moment.id}
                  onCopy={() => handleCopy(moment)}
                  onView={() => handleView(moment)}
                  confirmingRevoke={confirmingRevokeId === moment.id}
                  revoking={revokingId === moment.id}
                  onRequestRevoke={() => setConfirmingRevokeId(moment.id)}
                  onCancelRevoke={() => setConfirmingRevokeId(null)}
                  onConfirmRevoke={() => handleRevoke(moment)}
                  onSuggested={() => { loadMoments(); markSeen(moment.publicToken); }}
                  onFindAlternatives={() => markSeen(moment.publicToken)}
                  autoFindAlternatives={focusMomentToken !== undefined && focusMomentToken === moment.publicToken}
                />
              ))}
              {revokedMoments.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowRevoked((value) => !value)}
                    style={{ ...linkButtonStyle, textAlign: 'left' }}
                  >
                    {showRevoked ? 'Hide' : 'Show'} revoked ({revokedMoments.length}) {showRevoked ? '⌃' : '⌄'}
                  </button>
                  {showRevoked && revokedMoments.map((moment) => (
                    <MomentCard
                      key={moment.id}
                      moment={moment}
                      copied={copiedId === moment.id}
                      onCopy={() => handleCopy(moment)}
                      onView={() => handleView(moment)}
                      confirmingRevoke={false}
                      revoking={false}
                      onRequestRevoke={() => {}}
                      onCancelRevoke={() => {}}
                      onConfirmRevoke={() => {}}
                      onSuggested={loadMoments}
                      onFindAlternatives={() => markSeen(moment.publicToken)}
                      autoFindAlternatives={false}
                      confirmingDelete={confirmingDeleteId === moment.id}
                      deleting={deletingId === moment.id}
                      onRequestDelete={() => setConfirmingDeleteId(moment.id)}
                      onCancelDelete={() => setConfirmingDeleteId(null)}
                      onConfirmDelete={() => handleDelete(moment)}
                    />
                  ))}
                </>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}

function MomentCard({
  moment,
  copied,
  onCopy,
  onView,
  confirmingRevoke,
  revoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  onSuggested,
  onFindAlternatives,
  autoFindAlternatives,
  confirmingDelete,
  deleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  moment: SharedMomentRow;
  copied: boolean;
  onCopy: () => void;
  onView: () => void;
  confirmingRevoke: boolean;
  revoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  /** Called after a successful "Suggest this" so the parent can refetch the
   * list (the new moment shows up as its own row -- no separate thread UI). */
  onSuggested: () => void;
  /** Aura Updates V1: fired once, the first time this card's alternatives
   * are fetched -- marks the response seen (brief section 10: "'Find
   * another time' is used directly... marking the response seen is also
   * reasonable"). */
  onFindAlternatives?: () => void;
  /** Set when arriving here from a Home "Find another time" card -- jumps
   * straight into the search instead of leaving the owner to find the
   * button themselves. */
  autoFindAlternatives?: boolean;
  /** Permanent removal -- only ever offered for an already-REVOKED moment
   * (see the parent's revoked-section rendering); undefined for an ACTIVE
   * moment's card. */
  confirmingDelete?: boolean;
  deleting?: boolean;
  onRequestDelete?: () => void;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => void;
}) {
  const response = responseText(moment);
  const [alternatives, setAlternatives] = useState<AlternativesOutcome | null>(null);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [alternativesError, setAlternativesError] = useState('');
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<{ shareUrl: string } | null>(null);

  // Brief section 16: ACCEPTED is terminal for V1 -- no reschedule CTA.
  // Everyday Moment Rescheduling V1: a PLAN moment can look for another time
  // regardless of scope (GENERAL/PERSONAL/SHARED all route to a real
  // strategy in findAuraMomentAlternatives); a MUHURTHAM moment keeps the
  // exact original restriction -- SHARED only. hasSuccessor excluded here:
  // once an alternative has already been suggested for this response, redoing
  // "Find another time" would just offer to suggest a second successor for
  // the same original -- the owner already acted on it.
  const canFindAnotherTime = moment.status === 'ACTIVE' && moment.responseState === 'ANOTHER_TIME' && !moment.hasSuccessor && (moment.source === 'PLAN' || moment.scope === 'SHARED');

  const handleFindAlternatives = async () => {
    onFindAlternatives?.();
    setLoadingAlternatives(true);
    setAlternativesError('');
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/alternatives`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to find alternatives.');
      setAlternatives(data as AlternativesOutcome);
    } catch (err) {
      setAlternativesError(err instanceof Error ? err.message : 'Unable to find alternatives.');
    } finally {
      setLoadingAlternatives(false);
    }
  };

  useEffect(() => {
    if (autoFindAlternatives && canFindAnotherTime && !alternatives && !loadingAlternatives) {
      handleFindAlternatives();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFindAlternatives]);

  const handleSuggest = async (index: number) => {
    setSuggestingIndex(index);
    setAlternativesError('');
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to suggest this time.');
      setSuggested({ shareUrl: data.shareUrl });
      setAlternatives(null);
      onSuggested();
    } catch (err) {
      setAlternativesError(err instanceof Error ? err.message : 'Unable to suggest this time.');
    } finally {
      setSuggestingIndex(null);
    }
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {moment.activityIcon ?? '✨'} {moment.activityTitle}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
            {formatMomentDateLabel(moment.startAt, moment.timezone)}
            {moment.sharedPersonDisplayName ? ` · with ${moment.sharedPersonDisplayName}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: response.color, whiteSpace: 'nowrap' }}>{response.text}</span>
      </div>

      {moment.responseState === 'ANOTHER_TIME' && moment.responsePreference && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#dbe7f4' }}>
          <span style={{ color: '#94a3b8' }}>Preference: </span>
          <span style={{ fontWeight: 800 }}>{PREFERENCE_TEXT[moment.responsePreference]}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onView} style={linkButtonStyle}>
          View →
        </button>
        <button type="button" onClick={onCopy} style={linkButtonStyle}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {moment.status === 'ACTIVE' && (
          confirmingRevoke ? (
            <>
              <button type="button" onClick={onConfirmRevoke} disabled={revoking} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
                {revoking ? 'Revoking…' : 'Confirm revoke'}
              </button>
              <button type="button" onClick={onCancelRevoke} style={linkButtonStyle}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={onRequestRevoke} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
              Revoke
            </button>
          )
        )}
        {moment.status === 'REVOKED' && onRequestDelete && (
          confirmingDelete ? (
            <>
              <button type="button" onClick={onConfirmDelete} disabled={deleting} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
                {deleting ? 'Removing…' : 'Confirm remove'}
              </button>
              <button type="button" onClick={onCancelDelete} style={linkButtonStyle}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={onRequestDelete} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
              Remove
            </button>
          )
        )}
      </div>

      {canFindAnotherTime && !alternatives && !suggested && (
        <button type="button" onClick={handleFindAlternatives} disabled={loadingAlternatives} style={{ ...outlineButtonStyle, marginTop: 12 }}>
          {loadingAlternatives ? 'Finding alternatives…' : 'Find another time'}
        </button>
      )}

      {alternativesError && <div style={{ ...errorBoxStyle, marginTop: 10 }}>{alternativesError}</div>}

      {alternatives && alternatives.status === 'NOT_APPLICABLE' && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>Finding another time isn&apos;t available for this kind of moment yet -- try suggesting a new time directly.</p>
      )}
      {alternatives && alternatives.status === 'USER_PROFILE_INCOMPLETE' && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>Complete your own birth profile to find alternatives.</p>
      )}
      {alternatives && alternatives.status === 'SAVED_PERSON_PROFILE_INCOMPLETE' && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>This person&apos;s profile is incomplete.</p>
      )}
      {alternatives && alternatives.status === 'OK' && alternatives.candidates.length === 0 && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>No favorable alternatives found nearby -- try again later.</p>
      )}
      {alternatives && alternatives.status === 'OK' && alternatives.candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {/* Section 11: never ceremonial "Muhurtham" language for an
           * everyday activity -- planningMode picks the framing. */}
          <div style={sectionKickerStyle}>{moment.planningMode === 'EVERYDAY' ? 'Better times' : 'Alternative Muhurtham'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {alternatives.candidates.map((candidate, index) => (
              <div key={`${candidate.startAt}-${index}`} style={{ ...panchangaCellStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  {index === 0 && (
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#fb7185', marginBottom: 2 }}>
                      {moment.planningMode === 'EVERYDAY' ? '❤️ BETTER ALTERNATIVE' : '❤️ BEST ALTERNATIVE'}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{formatMomentDateLabel(candidate.startAt, moment.timezone)}</div>
                  <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 2 }}>{formatMomentTimeRange(candidate.startAt, candidate.endAt, moment.timezone)}</div>
                  <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2, fontWeight: 800 }}>{RATING_TEXT[candidate.ratingLabel] ?? candidate.ratingLabel}</div>
                </div>
                <button type="button" onClick={() => handleSuggest(index)} disabled={suggestingIndex !== null} style={linkButtonStyle}>
                  {suggestingIndex === index ? 'Suggesting…' : 'Suggest this'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {suggested && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
          ✓ New moment created -- share it from the top of this list.
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = theme.panelStyle;
const backButtonStyle: React.CSSProperties = theme.backButtonStyle;
const errorBoxStyle: React.CSSProperties = theme.errorBoxStyle;
const linkButtonStyle: React.CSSProperties = theme.linkButtonStyle;
const outlineButtonStyle: React.CSSProperties = { ...theme.outlineButtonStyle, width: '100%' };
const sectionKickerStyle: React.CSSProperties = theme.sectionKickerStyle;
const panchangaCellStyle: React.CSSProperties = theme.cellStyle;
