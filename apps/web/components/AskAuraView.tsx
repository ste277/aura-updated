'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
      text: `Hi ${userName}! I'm Aura. I'm synchronized with your ${activeWindow.replace('_', ' ').toUpperCase()} window in ${cityName}${
        userChart?.moonSign ? ` and aligned with your ${userChart.moonSign} Moon` : ''
      }. Ask me anything about timing a task, making a decision, or planning your day!`,
    },
  ]);

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
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--as-text, #f8fafc)',
            margin: 0,
            fontFamily: 'sans-serif',
            lineHeight: 1.2,
          }}
        >
          Ask Aura
        </h1>
        <p
          style={{
            fontSize: 12,
            color: 'var(--as-text-muted, #94a3b8)',
            marginTop: 4,
            fontFamily: 'sans-serif',
          }}
        >
          Your personal Panchang & timing guide •{' '}
          <span
            style={{
              color: 'var(--as-abhijit, #4ade80)',
              fontFamily: 'monospace',
              fontWeight: 600,
            }}
          >
            {activeWindow.replace(/_/g, ' ').toUpperCase()}
          </span>
        </p>
      </div>

      {/* Structured current context */}
      <div style={{ background: 'var(--as-surface-raised, #0f172a)', border: '1px solid rgba(74, 222, 128, 0.25)', borderRadius: 14, padding: 14 }}>
        <div style={{ fontSize: 10, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Now</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <strong style={{ fontSize: 15, color: '#f8fafc' }}>{activeWindow.replace(/_/g, ' ')}</strong>
          <span style={{ fontSize: 11, color: '#b6c2d1' }}>Current Panchang window</span>
        </div>
        <div style={{ fontSize: 11, color: '#dbe7f4', marginTop: 5, lineHeight: 1.4 }}>
          Ask about an activity, the best time today, or what to focus on next.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 10, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Aura suggests</span>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleSend(promptChips[0])}
          style={{ background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.22)', borderRadius: 10, padding: '11px 12px', textAlign: 'left', color: '#e2e8f0', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          {promptChips[0]}
          <span style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 400, marginTop: 4 }}>Get a recommendation based on your current window.</span>
        </button>
      </div>

      {/* Chat History Container */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
          minHeight: 240,
          maxHeight: 340,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.map((msg, index) => (
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

      {/* Quick Prompt Chips */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            color: 'var(--as-text-muted, #94a3b8)',
            letterSpacing: '0.05em',
            fontWeight: 600,
          }}
        >
          Suggested Inquiries
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {promptChips.map((chip) => (
            <button
              type="button"
              key={chip}
              disabled={loading}
              onClick={() => {
                if (onQuickPromptClick) onQuickPromptClick(chip);
                handleSend(chip);
              }}
              style={{
                background: 'var(--as-surface-raised, #0f172a)',
                border: '1px solid var(--as-border, #1e293b)',
                borderRadius: 10,
                padding: '10px 14px',
                textAlign: 'left',
                color: 'var(--as-text, #e2e8f0)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'sans-serif',
                cursor: loading ? 'default' : 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                opacity: loading ? 0.6 : 1,
              }}
            >
              <span>{chip}</span>
              <span style={{ color: 'var(--as-text-muted)', fontSize: 14 }}>
                ›
              </span>
            </button>
          ))}
        </div>
      </div>

      {recentQuestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Recent</span>
          {recentQuestions.map((question, index) => (
            <button key={`${question.text}-${index}`} type="button" disabled={loading} onClick={() => handleSend(question.text)} style={{ background: 'transparent', border: 'none', color: '#b6c2d1', fontSize: 11, textAlign: 'left', padding: '2px 0', cursor: loading ? 'default' : 'pointer' }}>
              {question.text}
            </button>
          ))}
        </div>
      )}

      {/* Input Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 24,
          padding: '6px 6px 6px 14px',
          marginTop: 4,
        }}
      >
        <input
          type="text"
          placeholder="Ask anything..."
          value={input}
          disabled={loading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--as-text, #fff)',
            fontSize: 12,
            fontFamily: 'sans-serif',
            outline: 'none',
            flex: 1,
          }}
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={!canSendInput}
          aria-label="Send message"
          style={{
            background: 'var(--as-abhijit, #4ade80)',
            border: 'none',
            borderRadius: '50%',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canSendInput ? 'pointer' : 'default',
            color: '#020617',
            fontWeight: 700,
            opacity: canSendInput ? 1 : 0.5,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
