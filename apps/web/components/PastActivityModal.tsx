'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface PastActivityModalProps {
  isOpen?: boolean;
  initialDate?: Date;
  selectedDate?: Date;
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onClose: () => void;
  onConfirmLog?: (activityTitle: string, notes?: string, customTimestamp?: Date) => Promise<void>;
  onSuccess?: () => void;
}

const WINDOW_SUGGESTIONS: Record<string, string[]> = {
  BRAHMA_MUHURTA: ['Meditation & Breathwork', 'Strategic Planning', 'Deep Study / Reading'],
  ABHIJIT: ['Important Client Calls', 'Key Decision / Sign-off', 'High-Focus Deep Work'],
  VIJAYA: ['Pitching / Sales', 'Difficult Conversations', 'Task Execution'],
  RAHU_KALAM: ['Routine Maintenance', 'Decluttering', 'Rest & Hydration'],
  YAMAGANDAM: ['Review & Audit', 'Internal Admin', 'Low-Risk Tasks'],
  GULIKA_KALAM: ['Long-term Setup', 'Asset Management', 'Document Filing'],
  NEUTRAL: ['Deep Work', 'Exercise & Fitness', 'Email & Comm Sync', 'Break & Relaxation'],
};

export function PastActivityModal({
  isOpen = true,
  initialDate,
  selectedDate,
  onClose,
  onConfirmLog,
  onSuccess,
}: PastActivityModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedChip, setSelectedChip] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');

  const [logTime, setLogTime] = useState(() => {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  });

  const [submitting, setSubmitting] = useState(false);
  const baseDate = selectedDate || initialDate || new Date();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeSuggestions = useMemo(() => {
    const [hours] = logTime.split(':').map(Number);
    if (hours >= 4 && hours < 6) return WINDOW_SUGGESTIONS.BRAHMA_MUHURTA;
    if (hours >= 11 && hours <= 12) return WINDOW_SUGGESTIONS.ABHIJIT;
    if (hours >= 15 && hours <= 16) return WINDOW_SUGGESTIONS.RAHU_KALAM;
    return WINDOW_SUGGESTIONS.NEUTRAL;
  }, [logTime]);

  const isFutureTimestamp = useMemo(() => {
    const [hours, minutes] = logTime.split(':').map(Number);
    const target = new Date(baseDate);
    target.setHours(hours || 0, minutes || 0, 0, 0);
    return target.getTime() > Date.now();
  }, [baseDate, logTime]);

  if (!isOpen || !mounted) return null;

  const activeTitle = customTitle.trim() || selectedChip;

  const handleChipSelect = (title: string) => {
    if (selectedChip === title && !customTitle) {
      setSelectedChip('');
    } else {
      setSelectedChip(title);
      setCustomTitle('');
    }
  };

  const handleQuickTimeOffset = (minutesOffset: number) => {
    const d = new Date();
    if (minutesOffset !== 0) {
      d.setMinutes(d.getMinutes() - minutesOffset);
    }
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    setLogTime(`${hrs}:${mins}`);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTitle || submitting || isFutureTimestamp) return;

    setSubmitting(true);

    try {
      const [hours, minutes] = logTime.split(':').map(Number);
      const targetTimestamp = new Date(baseDate);
      targetTimestamp.setHours(hours || 12, minutes || 0, 0, 0);

      if (onConfirmLog) {
        await onConfirmLog(activeTitle, '', targetTimestamp);
      } else {
        const res = await fetch('/api/habit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityTitle: activeTitle,
            activeWindow: 'NEUTRAL',
            logMinuteOfDay: (hours || 12) * 60 + (minutes || 0),
            logTimestamp: targetTimestamp.toISOString(),
          }),
        });

        if (!res.ok) throw new Error('Failed to save log');
      }

      setCustomTitle('');
      setSelectedChip('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving activity log:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const dateFormatted = baseDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(2, 6, 23, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <style>{`
        /* Keep native picker icon aligned to the right without stretching across the entire input */
        input[type="time"]::-webkit-calendar-picker-indicator {
          cursor: pointer;
          filter: invert(0.8);
          opacity: 0.6;
        }
        input[type="time"]::-webkit-calendar-picker-indicator:hover {
          opacity: 1;
        }
      `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, fontFamily: 'sans-serif', color: '#f8fafc' }}>
              Log Activity
            </h3>
            <span style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginTop: '2px', fontFamily: 'monospace' }}>
              {dateFormatted}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Time Selection */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label
              style={{
                fontSize: '10px',
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
                fontFamily: 'monospace',
              }}
            >
              SELECT TIME
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { label: 'Now', offset: 0 },
                { label: '-15m', offset: 15 },
                { label: '-30m', offset: 30 },
              ].map(({ label, offset }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleQuickTimeOffset(offset)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '10px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#020617',
              border: isFutureTimestamp ? '1px solid #f43f5e' : '1px solid #334155',
              borderRadius: '12px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <input
              type="time"
              value={logTime}
              onChange={(e) => setLogTime(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'transparent',
                border: 'none',
                color: '#f8fafc',
                fontSize: '15px',
                fontWeight: 700,
                outline: 'none',
                boxSizing: 'border-box',
                colorScheme: 'dark',
                fontFamily: 'monospace',
              }}
            />
          </div>

          {isFutureTimestamp && (
            <span style={{ fontSize: '10px', color: '#f43f5e', marginTop: '6px', display: 'block', fontFamily: 'monospace' }}>
              Cannot log activities for future time
            </span>
          )}
        </div>

        {/* 1-Click Suggestions */}
        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '10px',
              color: '#94a3b8',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
              fontFamily: 'monospace',
            }}
          >
            ⚡ 1-CLICK WINDOW SUGGESTIONS
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {activeSuggestions.map((suggestion) => {
              const isSelected = selectedChip === suggestion && !customTitle;
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleChipSelect(suggestion)}
                  disabled={submitting}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    backgroundColor: isSelected ? 'rgba(74, 222, 128, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                    border: isSelected ? '1px solid #4ade80' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isSelected ? '#4ade80' : '#f8fafc',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'sans-serif',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSelected ? '✓ ' : '+ '}
                  {suggestion}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Activity Entry Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '10px',
                color: '#94a3b8',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
                fontFamily: 'monospace',
              }}
            >
              OR CUSTOM ACTIVITY
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => {
                setCustomTitle(e.target.value);
                if (e.target.value) setSelectedChip('');
              }}
              placeholder="e.g., Code Review, Family Time"
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#020617',
                border: customTitle ? '1px solid #4ade80' : '1px solid #334155',
                borderRadius: '12px',
                color: '#f8fafc',
                fontSize: '12px',
                fontFamily: 'sans-serif',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: '1px solid #334155',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'sans-serif',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !activeTitle || isFutureTimestamp}
              style={{
                padding: '10px 20px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: isFutureTimestamp
                  ? 'rgba(244, 63, 94, 0.2)'
                  : activeTitle
                  ? '#4ade80'
                  : '#1e293b',
                color: isFutureTimestamp
                  ? '#f43f5e'
                  : activeTitle
                  ? '#020617'
                  : '#64748b',
                fontWeight: 700,
                fontSize: '12px',
                fontFamily: 'sans-serif',
                cursor: submitting || isFutureTimestamp || !activeTitle ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {submitting
                ? 'Saving...'
                : isFutureTimestamp
                ? 'Cannot log future time'
                : activeTitle
                ? `Save "${activeTitle.length > 14 ? activeTitle.slice(0, 14) + '...' : activeTitle}"`
                : 'Save Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

export default PastActivityModal;