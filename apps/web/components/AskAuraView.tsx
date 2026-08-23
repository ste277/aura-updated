'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, typography, radius } from './theme';
import { PageHeader, TextButton, SecondaryButton, StatusBadge } from './ui';
import { trackEvent } from '../lib/trackEvent';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';

/**
 * Ask Aura Orchestration V1 -- this view no longer parses intent or streams
 * an LLM response itself; it sends the raw prompt to POST /api/ask-aura and
 * renders whatever structured AskAuraResponse comes back (brief section 27:
 * "Wire the new structured responses into the existing/new UI primitives.
 * Do not redesign Ask again."). The empty-state / conversation-mode shell,
 * suggestions, and input bar are UNCHANGED from the UI Experience V2 pass --
 * only what fills the Aura message bubble is new.
 */

// Mirrors apps/web/lib/askAuraOrchestrator.ts's own response shape --
// duplicated (not imported) because that module pulls in server-only code
// (db.ts) that must never end up in a client bundle.
interface AskAuraCard {
  type: 'ACTIVITY_OPTIONS' | 'TIMING_RESULT' | 'PANCHANG_SUMMARY' | 'MUHURTHAM_RESULTS' | 'CLARIFICATION';
  [key: string]: unknown;
}
interface AskAuraAction {
  type: 'PLAN_THIS' | 'CREATE_MOMENT' | 'OPEN_PLAN' | 'OPEN_TIMELINE' | 'OPEN_PANCHANG' | 'OPEN_MUHURTHAM';
  label: string;
  planPayload?: Record<string, unknown>;
  momentPayload?: { activityId: string; startAt: string; endAt: string; savedPersonId?: string };
  activityId?: string;
}
interface AskAuraResponse {
  intent: string;
  message: string;
  cards?: AskAuraCard[];
  actions?: AskAuraAction[];
  context?: Record<string, unknown>;
}

type Message = { sender: 'user'; text: string } | { sender: 'aura'; response: AskAuraResponse };

export interface UserChartContext {
  lagnaSign?: string;
  moonSign?: string;
}

interface AskAuraProps {
  userName: string;
  activeWindow?: string;
  cityName?: string;
  userChart?: UserChartContext;
  onQuickPromptClick?: (promptText: string) => void;
  onPlanLogged?: () => void;
  onViewTimeline?: () => void;
  /** brief section 26 -- OPEN_PLAN/OPEN_MUHURTHAM navigation actions reuse
   * the exact same callbacks Home/Explore already use (page.tsx's
   * handleOpenPlan / handleOpenMuhurthamWithActivity), never a new
   * navigation mechanism. */
  onOpenPlan?: (activityTitle?: string) => void;
  onOpenPanchang?: () => void;
  onOpenMuhurthamWithActivity?: (activityId: string) => void;
}

function activityTitleFor(activityId?: string): string | undefined {
  if (!activityId) return undefined;
  return FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)?.title;
}

export function AskAuraView({
  userName,
  activeWindow = 'NEUTRAL',
  cityName = 'Chennai',
  onQuickPromptClick,
  onPlanLogged,
  onViewTimeline,
  onOpenPlan,
  onOpenPanchang,
  onOpenMuhurthamWithActivity,
}: AskAuraProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionState, setActionState] = useState<Record<string, 'saving' | 'done' | 'error'>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [greeting] = useState(`Hi ${userName} — I can help you decide what to do now, when to plan something, or what your day looks like.`);
  const [previousContext, setPreviousContext] = useState<Record<string, unknown> | undefined>(undefined);
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // Brief section 45: the conversation becomes primary the moment the user
  // has actually asked something -- the initial greeting alone still counts
  // as the calm empty state, not a "conversation in progress".
  const hasConversationStarted = messages.length > 0;

  const promptChips = useMemo(() => {
    const windowName = activeWindow.replace(/_/g, ' ').toLowerCase();
    if (windowName.includes('rahu') || windowName.includes('yama')) {
      return [
        'What should I do with the rest of my time?',
        'Should I avoid anything right now?',
        'When is my next good window?',
        'What can I do to prepare?',
      ];
    }
    return [
      'What should I do right now?',
      'Is this a good time to work out?',
      'Can I start an important task now?',
      'When is the best time for deep work?',
      'Should I avoid anything right now?',
      "What's my best window today?",
    ];
  }, [activeWindow]);

  const recentQuestions = messages
    .filter((m): m is Message & { sender: 'user' } => m.sender === 'user')
    .slice(-3)
    .reverse();
  const canSendInput = Boolean(input.trim()) && !loading;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend ?? input).trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { sender: 'user', text: query }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ask-aura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query, activeWindow, previousContext }),
      });
      if (!res.ok) throw new Error('Ask Aura request failed.');
      const data: AskAuraResponse = await res.json();
      setMessages((prev) => [...prev, { sender: 'aura', response: data }]);
      setPreviousContext(data.context);
    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: 'aura', response: { intent: 'UNKNOWN', message: 'Sorry, I hit a snag. Please try again.' } },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: AskAuraAction, key: string) => {
    if (action.type === 'OPEN_TIMELINE') return onViewTimeline?.();
    if (action.type === 'OPEN_PANCHANG') return onOpenPanchang?.();
    if (action.type === 'OPEN_MUHURTHAM') return onOpenMuhurthamWithActivity?.(action.activityId ?? '');
    if (action.type === 'OPEN_PLAN') return onOpenPlan?.(activityTitleFor(action.activityId));

    trackEvent('ASK_AURA_RESULT_ACTION', { metadata: { action: action.type } });
    setActionState((prev) => ({ ...prev, [key]: 'saving' }));
    try {
      if (action.type === 'PLAN_THIS' && action.planPayload) {
        const res = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action.planPayload),
        });
        if (!res.ok) throw new Error('Unable to save plan.');
        onPlanLogged?.();
      } else if (action.type === 'CREATE_MOMENT' && action.momentPayload) {
        const res = await fetch('/api/aura-moments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: action.momentPayload.savedPersonId ? 'SHARED' : 'GENERAL',
            source: 'PLAN',
            activityId: action.momentPayload.activityId,
            startAt: action.momentPayload.startAt,
            endAt: action.momentPayload.endAt,
            savedPersonId: action.momentPayload.savedPersonId,
          }),
        });
        if (!res.ok) throw new Error('Unable to create Moment.');
      }
      setActionState((prev) => ({ ...prev, [key]: 'done' }));
    } catch {
      setActionState((prev) => ({ ...prev, [key]: 'error' }));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <PageHeader title="Ask Aura ✨" subtitle="Your personal timing guide" />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' }}>
        <span style={typography.sectionEyebrow}>Now</span>
        <strong style={{ fontSize: 13, color: colors.textSecondary }}>{activeWindow.replace(/_/g, ' ')}</strong>
        {!hasConversationStarted && <span style={{ fontSize: 12, color: colors.textMuted }}>· Current Panchang window in {cityName}</span>}
      </div>

      <div
        style={
          hasConversationStarted
            ? { background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: spacing.lg, maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: spacing.md }
            : { display: 'flex', flexDirection: 'column', gap: spacing.md }
        }
      >
        {!hasConversationStarted && (
          <div style={bubbleStyle('aura')}>
            <div style={{ whiteSpace: 'pre-line' }}>{greeting}</div>
          </div>
        )}
        {messages.map((msg, index) =>
          msg.sender === 'user' ? (
            <div key={index} style={bubbleStyle('user')}>
              {msg.text}
            </div>
          ) : (
            <div key={index} style={bubbleStyle('aura')}>
              <div style={{ whiteSpace: 'pre-line' }}>{msg.response.message}</div>
              {msg.response.cards?.map((card, cardIndex) => (
                <AskAuraCardView key={cardIndex} card={card} onQuickReply={(text) => handleSend(text)} />
              ))}
              {msg.response.actions && msg.response.actions.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                  {msg.response.actions.map((action, actionIndex) => {
                    const key = `${index}-${actionIndex}`;
                    const state = actionState[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={state === 'saving' || state === 'done'}
                        onClick={() => runAction(action, key)}
                        style={actionButtonStyle(state)}
                      >
                        {state === 'saving' ? 'Saving…' : state === 'done' ? 'Done ✓' : action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}
        {loading && (
          <div style={{ alignSelf: 'flex-start', fontSize: 11, color: colors.textMuted, fontFamily: 'var(--as-font-mono)' }}>
            Aura is thinking...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {!hasConversationStarted && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <span style={typography.sectionEyebrow}>What would you like help with?</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
            {(showAllPrompts ? promptChips : promptChips.slice(0, 4)).map((chip) => (
              <button
                type="button"
                key={chip}
                disabled={loading}
                onClick={() => {
                  if (onQuickPromptClick) onQuickPromptClick(chip);
                  handleSend(chip);
                }}
                style={{
                  background: colors.surfaceSubtle,
                  border: `1px solid ${colors.borderSubtle}`,
                  borderRadius: radius.md,
                  padding: '12px 14px',
                  textAlign: 'left',
                  color: colors.textSecondary,
                  fontSize: 13,
                  fontWeight: 650,
                  fontFamily: 'sans-serif',
                  cursor: loading ? 'default' : 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <span>{chip}</span>
                <span style={{ color: colors.textMuted, fontSize: 14 }}>›</span>
              </button>
            ))}
          </div>
          {!showAllPrompts && promptChips.length > 4 && (
            <TextButton onClick={() => setShowAllPrompts(true)} color={colors.textMuted} style={{ alignSelf: 'flex-start' }}>
              Show more →
            </TextButton>
          )}
        </div>
      )}

      {!hasConversationStarted && recentQuestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
          <span style={typography.sectionEyebrow}>Recent</span>
          {recentQuestions.map((question, index) => (
            <button key={`${question.text}-${index}`} type="button" disabled={loading} onClick={() => handleSend(question.text)} style={{ background: 'transparent', border: 'none', color: colors.textFaint, fontSize: 12, textAlign: 'left', padding: '2px 0', cursor: loading ? 'default' : 'pointer' }}>
              {question.text}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          minHeight: 52,
          background: colors.surfaceSubtle,
          border: `1px solid ${isInputFocused ? colors.borderFocus : colors.borderSubtle}`,
          borderRadius: radius.pill,
          padding: '6px 6px 6px 16px',
          marginTop: spacing.xs,
          boxSizing: 'border-box',
        }}
      >
        <input
          type="text"
          placeholder="Ask Aura anything..."
          value={input}
          disabled={loading}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          style={{ background: 'none', border: 'none', color: colors.textPrimary, fontSize: 14, fontFamily: 'sans-serif', outline: 'none', flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={!canSendInput}
          aria-label="Send message"
          style={{
            background: colors.positive,
            border: 'none',
            borderRadius: radius.pill,
            width: 38,
            height: 38,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canSendInput ? 'pointer' : 'default',
            color: colors.textInverse,
            fontWeight: 700,
            fontSize: 16,
            opacity: canSendInput ? 1 : 0.5,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

function bubbleStyle(sender: 'user' | 'aura'): React.CSSProperties {
  return {
    alignSelf: sender === 'user' ? 'flex-end' : 'flex-start',
    background: sender === 'user' ? colors.positive : 'rgba(30, 41, 59, 0.7)',
    color: sender === 'user' ? colors.textInverse : colors.textPrimary,
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 13,
    maxWidth: '90%',
    lineHeight: 1.4,
    fontWeight: sender === 'user' ? 650 : 400,
    border: sender === 'aura' ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
  };
}

function actionButtonStyle(state: 'saving' | 'done' | 'error' | undefined): React.CSSProperties {
  return {
    border: `1px solid ${state === 'done' ? 'rgba(74, 222, 128, 0.4)' : 'rgba(56, 189, 248, 0.3)'}`,
    borderRadius: radius.pill,
    background: state === 'done' ? colors.positiveSoft : 'transparent',
    color: state === 'done' ? colors.positive : colors.info,
    fontSize: 11,
    fontWeight: 800,
    padding: '5px 10px',
    cursor: state === 'saving' || state === 'done' ? 'default' : 'pointer',
    opacity: state === 'saving' ? 0.65 : 1,
  };
}

// ============================================================
// Card renderers -- one small function per AskAuraCardType (brief section
// 17). Restrained styling matching the existing bubble aesthetic; no new
// visual language introduced.
// ============================================================

function AskAuraCardView({ card, onQuickReply }: { card: AskAuraCard; onQuickReply: (text: string) => void }) {
  if (card.type === 'ACTIVITY_OPTIONS') {
    const options = (card.options as Array<{ id: string; icon?: string; title: string; description?: string }>) ?? [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
        {options.map((opt) => (
          <div key={opt.id} style={{ fontSize: 12, color: colors.textSecondary }}>
            {opt.icon ? `${opt.icon} ` : ''}{opt.title}
          </div>
        ))}
      </div>
    );
  }

  if (card.type === 'TIMING_RESULT') {
    const requested = card.requested as { startLabel: string; endLabel: string; score: number; label: string; windowLabel: string; reasons: string[] } | undefined;
    const best = card.best as typeof requested;
    const betterNearby = card.betterNearby as typeof requested;
    const results = card.results as Array<{ startLabel: string; endLabel: string; sharedScore?: number; rating?: string }> | undefined;
    const primary = best ?? requested;
    return (
      <div style={{ marginTop: 9, fontSize: 12, color: colors.textSecondary }}>
        {primary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: colors.textPrimary }}>{primary.startLabel} – {primary.endLabel}</strong>
            <StatusBadge label={`${primary.score}/10 · ${primary.label}`} tone={primary.label === 'CAUTION' ? 'caution' : 'positive'} />
          </div>
        )}
        {primary?.reasons?.[0] && <div style={{ marginTop: 4, fontSize: 11, color: colors.textFaint }}>{primary.reasons[0]}</div>}
        {betterNearby && (
          <div style={{ marginTop: 6, fontSize: 11, color: colors.textFaint }}>
            Better nearby: {betterNearby.startLabel} · {betterNearby.score}/10
          </div>
        )}
        {results && results.length > 1 && (
          <div style={{ marginTop: 6, fontSize: 11, color: colors.textFaint }}>
            {results.slice(1).map((r, i) => (
              <div key={i}>{r.startLabel} – {r.endLabel}{r.sharedScore ? ` · ${r.sharedScore}/10` : ''}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.type === 'PANCHANG_SUMMARY') {
    const panchanga = card.panchanga as { vara: string; tithi: { name: string }; nakshatra: { name: string }; yoga: { name: string }; karana: { name: string } };
    return (
      <div style={{ marginTop: 9, fontSize: 12, color: colors.textSecondary, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <div>Vara: {panchanga.vara}</div>
        <div>Tithi: {panchanga.tithi.name}</div>
        <div>Nakshatra: {panchanga.nakshatra.name}</div>
        <div>Yoga: {panchanga.yoga.name}</div>
        <div>Karana: {panchanga.karana.name}</div>
      </div>
    );
  }

  if (card.type === 'MUHURTHAM_RESULTS') {
    const dates = (card.dates as Array<{ date: string; rating: string; startLabel: string; endLabel: string }>) ?? [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
        {dates.map((d, i) => (
          <div key={i} style={{ fontSize: 12, color: colors.textSecondary }}>
            <strong style={{ color: colors.textPrimary }}>{d.date}</strong> · {d.startLabel}–{d.endLabel} · {d.rating}
          </div>
        ))}
      </div>
    );
  }

  if (card.type === 'CLARIFICATION') {
    const options = (card.options as string[]) ?? [];
    if (options.length === 0) return null;
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
        {options.map((opt) => (
          <SecondaryButton key={opt} onClick={() => onQuickReply(opt)} style={{ minHeight: 32, padding: '0 12px', fontSize: 11 }}>
            {opt}
          </SecondaryButton>
        ))}
      </div>
    );
  }

  return null;
}
