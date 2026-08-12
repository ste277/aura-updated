'use client';

import React, { useState } from 'react';

interface Message {
  sender: 'user' | 'aura';
  text: string;
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
}

export function AskAuraView({
  userName,
  activeWindow = 'NEUTRAL',
  cityName = 'Chennai',
  userChart,
  onQuickPromptClick,
}: AskAuraProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'aura',
      text: `Hi ${userName}! I'm Aura. I'm synchronized with your ${activeWindow.replace('_', ' ').toUpperCase()} window in ${cityName}${
        userChart?.moonSign ? ` and aligned with your ${userChart.moonSign} Moon` : ''
      }. Ask me anything about timing a task, making a decision, or planning your day!`,
    },
  ]);

  const promptChips = [
    'Is this a good time to work out?',
    'Can I start an important task now?',
    'Is this a good time for a meeting?',
    'Should I avoid anything right now?',
    'When is the best time to meditate?',
  ];

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
          activeWindow,
          cityName,
          userName,
          lagnaSign: userChart?.lagnaSign,
          moonSign: userChart?.moonSign,
        }),
      });

      if (!res.body) throw new Error('No streaming response body available');

      // Read response chunks token-by-token
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
          AI Panchang & scheduling companion •{' '}
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
            {msg.text || (loading && index === messages.length - 1 ? '...' : '')}
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
          onClick={() => handleSend()}
          disabled={loading}
          style={{
            background: 'var(--as-abhijit, #4ade80)',
            border: 'none',
            borderRadius: '50%',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: loading ? 'default' : 'pointer',
            color: '#020617',
            fontWeight: 700,
            opacity: loading ? 0.5 : 1,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}