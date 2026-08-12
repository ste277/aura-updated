'use client';

import React from 'react';

interface RecommendedAction {
  id: string;
  title: string;
  description: string;
  category: string;
  duration?: string;
  isBestMatch?: boolean;
}

interface RecommendationsViewProps {
  activeWindowName: string;
  recommendations: RecommendedAction[];
  loggedIds: Set<string>;
  onLog: (action: RecommendedAction) => void;
}

export function RecommendationsView({
  activeWindowName,
  recommendations,
  loggedIds,
  onLog,
}: RecommendationsViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--as-text, #f8fafc)', margin: 0 }}>
          Recommended for You
        </h1>
        <p style={{ fontSize: 11, color: 'var(--as-text-muted, #94a3b8)', marginTop: 2 }}>
          Optimized for current window: <strong style={{ color: 'var(--as-abhijit, #4ade80)' }}>{activeWindowName}</strong>
        </p>
      </div>

      {/* Action Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {recommendations.map((rec) => {
          const isLogged = loggedIds.has(rec.id);
          return (
            <div
              key={rec.id}
              style={{
                background: 'var(--as-surface-raised, #0f172a)',
                border: rec.isBestMatch
                  ? '1.5px solid var(--as-abhijit, #4ade80)'
                  : '1px solid var(--as-border, #1e293b)',
                borderRadius: 16,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                position: 'relative',
              }}
            >
              {rec.isBestMatch && (
                <span
                  style={{
                    position: 'absolute',
                    top: -10,
                    left: 16,
                    fontSize: 8,
                    fontFamily: 'var(--as-font-mono)',
                    textTransform: 'uppercase',
                    background: 'var(--as-abhijit-dim, #1f4d34)',
                    color: 'var(--as-abhijit, #4ade80)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontWeight: 700,
                  }}
                >
                  Best Match
                </span>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(74, 222, 128, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                    }}
                  >
                    🎯
                  </div>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--as-text, #fff)', margin: 0 }}>
                      {rec.title}
                    </h3>
                    <p style={{ fontSize: 11, color: 'var(--as-text-muted, #94a3b8)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                      {rec.description}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10, marginTop: 2 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--as-font-mono)', color: 'var(--as-text-muted, #94a3b8)' }}>
                  {rec.duration || '20 - 30 min'}
                </span>
                <button
                  onClick={() => onLog(rec)}
                  disabled={isLogged}
                  style={{
                    background: isLogged ? 'rgba(74, 222, 128, 0.2)' : 'var(--as-abhijit, #4ade80)',
                    color: isLogged ? 'var(--as-abhijit, #4ade80)' : '#020617',
                    border: 'none',
                    borderRadius: 20,
                    padding: '6px 14px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: isLogged ? 'default' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isLogged ? '✓ Logged' : 'Log this'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}