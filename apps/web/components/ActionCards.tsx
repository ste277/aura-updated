'use client';

import { useState } from 'react';
import type { ActionCard } from '../../../packages/recommendation/src/actionCards';

interface ActionCardsProps {
  cards: ActionCard[];
  onLog: (card: ActionCard) => void;
  loggedIds: Set<string>;
}

const CATEGORY_LABEL: Partial<Record<ActionCard['category'], string>> = {
  WORKOUT: 'Workout',
  MEAL: 'Meal',
  MICRO_BREAK: 'Micro-break',
  FOCUS: 'Focus',
  REST: 'Rest',
};

export function ActionCards({ cards, onLog, loggedIds }: ActionCardsProps) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span
          style={{
            fontFamily: 'var(--as-font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--as-text-muted)',
          }}
        >
          Recommended for you
        </span>
        <button
          onClick={() => setShowWhy((v) => !v)}
          style={{ fontSize: 11, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Why these?
        </button>
      </div>

      {showWhy && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--as-text-muted)',
            background: 'var(--as-surface-raised)',
            border: '1px solid var(--as-border)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          These come from the solar window you're currently in (or selected on the
          dial) — each of the five panchang windows has traditional associations
          (peak focus, high friction, steady growth, and so on) that map to a
          workout, meal, or break type. No AI is involved in picking these three;
          it's a direct lookup from the window you're in.
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {cards.map((card) => {
          const logged = loggedIds.has(card.id);
          return (
            <div
              key={card.id}
              style={{
                background: 'var(--as-surface-raised)',
                border: '1px solid var(--as-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--as-font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--as-text-muted)',
                  marginBottom: 6,
                }}
              >
                {CATEGORY_LABEL[card.category] || card.category.replace(/_/g, ' ')}
              </div>
              <div
                style={{
                  fontFamily: 'var(--as-font-display)',
                  fontSize: 16,
                  color: 'var(--as-text)',
                  marginBottom: 4,
                }}
              >
                {card.title}
              </div>
              <div style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)' }}>
                {card.reasoning ?? card.description}
              </div>
              <button
                onClick={() => onLog(card)}
                disabled={logged}
                style={{
                  marginTop: 10,
                  fontFamily: 'var(--as-font-body)',
                  fontSize: 13,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--as-border)',
                  background: logged ? 'var(--as-abhijit-dim)' : 'transparent',
                  color: logged ? 'var(--as-abhijit)' : 'var(--as-text)',
                  cursor: logged ? 'default' : 'pointer',
                }}
              >
                {logged ? 'Logged' : 'Log this'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
