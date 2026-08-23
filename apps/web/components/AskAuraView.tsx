'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, typography, radius } from './theme';
import { PageHeader, TextButton } from './ui';

interface Message {
  sender: 'user' | 'aura';
  text: string;
  responseType?: string;
  actions?: string[];
  activity?: string;
  recommendation?: AuraRecommendation;
}

interface AuraRecommendation {
  type: string;
  start: string;
  end: string;
  label: string;
  reason: string;
  startsAtLocal?: string;
  endsAtLocal?: string;
  googleCalendarUrl?: string;
  durationMinutes?: number;
  matchLabel?: string;
}

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
}

function formatActionLabel(action: string, isSaving: boolean, isSaved: boolean) {
  if (['SCHEDULE', 'SLOT_TASK', 'PLAN_THIS'].includes(action)) {
    if (isSaving) return 'Saving...';
    if (isSaved) return 'Planned';
    return 'Plan this';
  }
  if (action === 'VIEW_TIMELINE') return 'View timeline';
  return action.replace(/_/g, ' ');
}

export function AskAuraView({
  userName,
  activeWindow = 'NEUTRAL',
  cityName = 'Chennai',
  userChart,
  onQuickPromptClick,
  onPlanLogged,
  onViewTimeline,
}: AskAuraProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingActionIndex, setSavingActionIndex] = useState<number | null>(null);
  const [savedActionIndexes, setSavedActionIndexes] = useState<Set<number>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'aura',
      text: `Hi ${userName} — I can help you decide what to do now, when to plan something, or what your day looks like.`,
    },
  ]);
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // Brief section 45: the conversation becomes primary the moment the user
  // has actually asked something -- the initial greeting alone (length 1)
  // still counts as the calm empty state, not a "conversation in progress".
  const hasConversationStarted = messages.length > 1;

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

  const recentQuestions = messages.filter((message) => message.sender === 'user').slice(-3).reverse();
  const canSendInput = Boolean(input.trim()) && !loading;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || input;
    if (!query.trim() || loading) return;

    // Append user message and empty shell for Aura's streaming tokens
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: query },
      { sender: 'aura', text: '' },
    ]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ask-aura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: query,
            conversation: messages.slice(-8),
            activeWindow,
          cityName,
          userName,
          lagnaSign: userChart?.lagnaSign,
          moonSign: userChart?.moonSign,
        }),
      });

      if (!res.body) throw new Error('No streaming response body available');

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const decision = await res.json();
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            sender: 'aura',
            text: decision.text || 'I could not form a recommendation.',
            responseType: decision.responseType,
            actions: decision.actions,
            activity: decision.activity,
            recommendation: decision.recommendation,
          };
          return next;
        });
        return;
      }

      // Read response chunks token-by-token for the optional language layer.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulatedText += decoder.decode(value, { stream: true });

        // Update the latest bubble in real-time
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { sender: 'aura', text: accumulatedText };
          return next;
        });
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          sender: 'aura',
          text: 'Sorry, I hit a snag connecting to the advice engine. Please try again.',
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMessageAction = async (message: Message, action: string, index: number) => {
    if (action === 'VIEW_TIMELINE') {
      onViewTimeline?.();
      return;
    }

    if (!['SCHEDULE', 'SLOT_TASK', 'PLAN_THIS'].includes(action) || !message.recommendation?.startsAtLocal || !message.recommendation?.endsAtLocal) {
      return;
    }

    setSavingActionIndex(index);
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      const recommendation = message.recommendation;
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: message.activity || 'Aura recommendation',
          activityType: message.activity || 'Aura recommendation',
          plannedStartAt: recommendation.startsAtLocal,
          plannedEndAt: recommendation.endsAtLocal,
          durationMinutes: recommendation.durationMinutes ?? 30,
          windowType: recommendation.type || recommendation.label || 'NEUTRAL',
          windowLabel: recommendation.label,
          matchLabel: recommendation.matchLabel || 'Good Match',
          recommendation: recommendation.reason,
          calendarUrl: recommendation.googleCalendarUrl,
        }),
      });
      if (!res.ok) throw new Error('Unable to save plan.');
      setSavedActionIndexes((prev) => new Set(prev).add(index));
      onPlanLogged?.();
    } catch (err) {
      console.error('Failed to save Ask Aura plan:', err);
      setActionErrors((prev) => ({
        ...prev,
        [index]: 'Could not save that plan. Try again.',
      }));
    } finally {
      setSavingActionIndex(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingBottom: 24,
        fontFamily: 'sans-serif',
        color: '#f8fafc',
      }}
    >
      <PageHeader
        title="Ask Aura ✨"
        subtitle="Your personal timing guide"
      />

      {/* Current context -- a small supporting line, not a bordered card
       * (brief section 44/45: "current-context card too large" was one of
       * the diagnosed issues; once a conversation starts it recedes further
       * by dropping to a single inline line). */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' }}>
        <span style={typography.sectionEyebrow}>Now</span>
        <strong style={{ fontSize: 13, color: colors.textSecondary }}>{activeWindow.replace(/_/g, ' ')}</strong>
        {!hasConversationStarted && <span style={{ fontSize: 12, color: colors.textMuted }}>· Current Panchang window in {cityName}</span>}
      </div>

      {/* Chat -- always rendered (the greeting is message[0]), but only
       * grows into a real scrolling transcript once a real exchange exists;
       * before that it's just the single calm greeting line, never a big
       * empty reserved panel (brief section 44). */}
      <div
        style={
          hasConversationStarted
            ? {
                background: colors.surfaceSubtle,
                border: `1px solid ${colors.borderSubtle}`,
                borderRadius: radius.lg,
                padding: spacing.lg,
                maxHeight: 420,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.md,
              }
            : { display: 'flex', flexDirection: 'column', gap: spacing.md }
        }
      >
        {(hasConversationStarted ? messages : messages.slice(0, 1)).map((msg, index) => (
          <div
            key={index}
            style={{
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              background:
                msg.sender === 'user'
                  ? 'var(--as-abhijit, #4ade80)'
                  : 'rgba(30, 41, 59, 0.7)',
              color: msg.sender === 'user' ? '#020617' : 'var(--as-text, #f8fafc)',
              padding: '10px 14px',
              borderRadius: 12,
              fontSize: 12,
              maxWidth: '85%',
              lineHeight: 1.4,
              fontFamily: 'sans-serif',
              fontWeight: msg.sender === 'user' ? 600 : 400,
              border:
                msg.sender === 'aura'
                  ? '1px solid rgba(255, 255, 255, 0.05)'
                  : 'none',
            }}
          >
            {msg.responseType && (
              <div style={{ fontSize: 9, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, marginBottom: 6 }}>
                {msg.responseType.replace(/_/g, ' ')}
              </div>
            )}
            <div style={{ whiteSpace: 'pre-line' }}>{msg.text || (loading && index === messages.length - 1 ? '...' : '')}</div>
            {msg.actions && msg.actions.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                {msg.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={savingActionIndex === index || (['SCHEDULE', 'SLOT_TASK', 'PLAN_THIS'].includes(action) && savedActionIndexes.has(index))}
                    onClick={() => handleMessageAction(msg, action, index)}
                    style={{
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 999,
                      background: savedActionIndexes.has(index) && ['SCHEDULE', 'SLOT_TASK', 'PLAN_THIS'].includes(action) ? 'rgba(74, 222, 128, 0.14)' : 'transparent',
                      color: savedActionIndexes.has(index) && ['SCHEDULE', 'SLOT_TASK', 'PLAN_THIS'].includes(action) ? '#4ade80' : '#7dd3fc',
                      fontSize: 9,
                      fontWeight: 800,
                      padding: '4px 7px',
                      cursor: savingActionIndex === index ? 'default' : 'pointer',
                      opacity: savingActionIndex === index ? 0.65 : 1,
                    }}
                  >
                    {formatActionLabel(action, savingActionIndex === index, savedActionIndexes.has(index))}
                  </button>
                ))}
              </div>
            )}
            {actionErrors[index] && (
              <div style={{ color: '#fb7185', fontSize: 10, lineHeight: 1.35, marginTop: 7 }}>
                {actionErrors[index]}
              </div>
            )}
          </div>
        ))}
        {loading && messages[messages.length - 1]?.text === '' && (
          <div
            style={{
              alignSelf: 'flex-start',
              fontSize: 11,
              color: 'var(--as-text-muted, #94a3b8)',
              fontFamily: 'monospace',
            }}
          >
            Aura is analyzing transits...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestions -- ONE consolidated section (brief section 43/44/45:
       * "duplicate suggestion sections" was a diagnosed issue -- the old
       * "Aura suggests" hero chip and "Suggested Inquiries" list were the
       * same promptChips array shown twice). Capped to 4 with a "Show
       * more" reveal; disappears entirely once a real conversation exists
       * so it never competes with the transcript for attention. */}
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

      {/* Input Bar (brief section 47: prominent, calm, modern; 44px+
       * target; visible focus). */}
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
          style={{
            background: 'none',
            border: 'none',
            color: colors.textPrimary,
            fontSize: 14,
            fontFamily: 'sans-serif',
            outline: 'none',
            flex: 1,
            minWidth: 0,
          }}
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
