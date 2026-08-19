'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface PastActivityModalProps {
  isOpen?: boolean;
  initialDate?: Date;
  selectedDate?: Date;
  recentActivities?: string[];
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onClose: () => void;
  onConfirmLog?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string,
    durationMinutes?: number,
    logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION',
    activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH'
  ) => Promise<void>;
  onSuccess?: () => void;
}

export function PastActivityModal({
  isOpen = true,
  initialDate,
  selectedDate,
  recentActivities = [],
  onClose,
  onConfirmLog,
  onSuccess,
}: PastActivityModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedChip, setSelectedChip] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [activitySignificance, setActivitySignificance] = useState<'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH'>('AUTO');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const activityInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
    if (!isOpen || !mounted) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => activityInputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [isOpen, mounted]);

  useEffect(() => {
    if (!isOpen || !mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, mounted]);

  useEffect(() => {
    if (!isOpen || !mounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mounted, onClose]);

  const activeSuggestions = useMemo(() => {
    const common = ['Deep Work', 'Exercise', 'Meeting', 'Break', 'Reading', 'Family Time'];
    return [...new Set([...recentActivities, ...common])].slice(0, 6);
  }, [recentActivities]);

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
      const cleanNotes = notes.trim();
      const explicitSignificance = activitySignificance === 'AUTO' ? undefined : activitySignificance;

      if (onConfirmLog) {
        await onConfirmLog(activeTitle, cleanNotes, targetTimestamp, undefined, durationMinutes, 'MANUAL', explicitSignificance);
      } else {
        const res = await fetch('/api/habit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityTitle: activeTitle,
            activeWindow: 'NEUTRAL',
            logMinuteOfDay: (hours || 12) * 60 + (minutes || 0),
            logTimestamp: targetTimestamp.toISOString(),
            durationMinutes,
            notes: cleanNotes,
            activitySignificance: explicitSignificance,
          }),
        });

        if (!res.ok) throw new Error('Failed to save log');
      }

      setCustomTitle('');
      setSelectedChip('');
      setNotes('');
      setActivitySignificance('AUTO');
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
        padding: '16px',
        overflowY: 'auto',
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-log-title"
        aria-describedby="quick-log-date"
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: '20px',
          padding: '24px',
          margin: 'min(6vh, 32px) 0',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
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
            <h3 id="quick-log-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700, fontFamily: 'sans-serif', color: '#f8fafc' }}>
              Quick Log
            </h3>
            <span id="quick-log-date" style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginTop: '2px', fontFamily: 'monospace' }}>
              {dateFormatted}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick log"
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
              WHEN?
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { label: 'Now', offset: 0 },
                { label: '15m ago', offset: 15 },
                { label: '30m ago', offset: 30 },
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

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontFamily: 'monospace' }}>
            DURATION
          </label>
          <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} style={{ width: '100%', background: '#020617', border: '1px solid #334155', borderRadius: 10, color: '#f8fafc', padding: '10px 12px', fontSize: 12 }}>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
            <option value={90}>90 minutes</option>
          </select>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontFamily: 'monospace' }}>
            SIGNIFICANCE
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { value: 'AUTO' as const, label: 'Auto' },
              { value: 'LOW' as const, label: 'Light' },
              { value: 'MEDIUM' as const, label: 'Medium' },
              { value: 'HIGH' as const, label: 'High impact' },
            ].map((option) => {
              const selected = activitySignificance === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setActivitySignificance(option.value)}
                  disabled={submitting}
                  style={{
                    minHeight: 36,
                    flex: '1 1 72px',
                    borderRadius: 10,
                    border: selected ? '1px solid #4ade80' : '1px solid #334155',
                    background: selected ? 'rgba(74, 222, 128, 0.13)' : '#020617',
                    color: selected ? '#4ade80' : '#cbd5e1',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.4, marginTop: 7 }}>
            Auto lets Aura infer impact from the activity title.
          </div>
        </div>

        {/* Quick Log Suggestions */}
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
            RECENT & COMMON
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
              WHAT DID YOU DO?
            </label>
            <input
              ref={activityInputRef}
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
              NOTES
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context, outcome, or reflection"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#020617',
                border: notes.trim() ? '1px solid #38bdf8' : '1px solid #334155',
                borderRadius: '12px',
                color: '#f8fafc',
                fontSize: '12px',
                fontFamily: 'sans-serif',
                outline: 'none',
                boxSizing: 'border-box',
                resize: 'vertical',
                minHeight: 74,
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
