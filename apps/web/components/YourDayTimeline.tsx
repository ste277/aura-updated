'use client';

import React from 'react';
import type { DailyAgenda, DailyAgendaItem } from '../lib/dailyAgenda';
import { formatActivityDuration } from '../lib/activityDuration';
import { colors, spacing, radius, typography } from './theme';
import { SectionHeader, TextButton, EmptyState } from './ui';

/**
 * My Day V1 (brief section 8/36) -- "Your Day": one clean chronological
 * list, not a grid of independent large cards. Past/completed items are
 * subdued, the current item is slightly emphasized, starting-soon gets a
 * subtle accent, everything else is normal weight -- brief section 8's
 * exact visual-treatment ladder, implemented as row styling, not a fifth
 * card type.
 */

function formatItemTime(item: DailyAgendaItem, timezone: string): string {
  const time = new Date(item.startAt).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  if (item.type === 'COMPLETED_ACTIVITY') {
    return `${formatActivityDuration({ durationMinutes: item.durationMinutes ?? 0 })} · ${time}`;
  }
  return time;
}

function statusLabel(item: DailyAgendaItem): string | null {
  if (item.status === 'WAITING') return 'Waiting for response';
  if (item.status === 'CONFIRMED') return 'Confirmed';
  if (item.status === 'COMPLETED' && item.type === 'COMPLETED_ACTIVITY') return formatActivityDuration({ durationMinutes: item.durationMinutes ?? 0 });
  return null;
}

function itemMarker(item: DailyAgendaItem): string {
  if (item.status === 'COMPLETED') return '✓';
  // Brief section 3/4 (Daily Reflection & Tomorrow Preview V1): a MISSED
  // item is a calm, plain fact -- a faint dash, never a warning glyph.
  if (item.status === 'MISSED') return '–';
  if (item.status === 'CURRENT') return '●';
  if (item.status === 'WAITING') return '◌';
  if (item.icon) return item.icon;
  return item.type === 'MOMENT' ? '❤️' : '•';
}

function markerColor(item: DailyAgendaItem): string {
  if (item.status === 'COMPLETED') return colors.positive;
  // Deliberately the same muted tone as any other subdued row -- no red,
  // no caution color. A missed plan is not an error state.
  if (item.status === 'MISSED') return colors.textMuted;
  if (item.status === 'CURRENT') return colors.info;
  if (item.status === 'WAITING') return colors.caution;
  return colors.textMuted;
}

function AgendaRow({ item, timezone, onOpen, isNext }: { item: DailyAgendaItem; timezone: string; onOpen?: (item: DailyAgendaItem) => void; isNext?: boolean }) {
  const subdued = item.status === 'COMPLETED' || item.status === 'MISSED';
  const emphasized = item.status === 'CURRENT' || isNext;
  const label = statusLabel(item);
  const title = item.type === 'MOMENT' && item.participantDisplayName ? `${item.title} with ${item.participantDisplayName}` : item.title;

  const Wrapper = onOpen ? 'button' : 'div';
  return (
    <Wrapper
      type={onOpen ? 'button' : undefined}
      onClick={onOpen ? () => onOpen(item) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr auto',
        alignItems: 'center',
        gap: spacing.md,
        width: '100%',
        padding: `${spacing.sm}px 0`,
        background: 'transparent',
        border: 'none',
        borderLeft: isNext ? `2px solid ${colors.info}` : '2px solid transparent',
        paddingLeft: isNext ? spacing.sm - 2 : 0,
        borderBottom: `1px solid ${colors.borderSubtle}`,
        textAlign: 'left',
        cursor: onOpen ? 'pointer' : 'default',
        opacity: subdued ? 0.6 : 1,
        minHeight: 44,
      }}
    >
      <span aria-hidden="true" style={{ color: markerColor(item), fontSize: item.status === 'CURRENT' || item.status === 'WAITING' ? 10 : 15, textAlign: 'center' }}>
        {itemMarker(item)}
      </span>
      <span style={{ minWidth: 0 }}>
        {/* Daily Reflection & Tomorrow Preview V1 follow-up (Home cleanup
         * brief section 2) -- the small "NEXT" eyebrow replacing the old
         * standalone "What's Next" card's duplicate content. Never shown
         * for a COMPLETED/MISSED row -- isNext only ever matches
         * DailyAgenda.nextItem, which by construction excludes both. */}
        {isNext && <div style={{ ...typography.caption, color: colors.info, fontWeight: 900, letterSpacing: 0.4, marginBottom: 2 }}>NEXT</div>}
        <div style={{ ...typography.bodyStrong, fontWeight: emphasized ? 850 : 700, textDecoration: item.status === 'COMPLETED' ? 'line-through' : 'none', textDecorationColor: colors.borderDefault, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
      </span>
      <span style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ ...typography.meta, color: emphasized ? colors.info : colors.textMuted }}>{formatItemTime(item, timezone)}</div>
        {label && <div style={{ ...typography.caption, color: item.status === 'WAITING' ? colors.caution : colors.positive, marginTop: 2 }}>{label}</div>}
      </span>
    </Wrapper>
  );
}

export function YourDayTimeline({
  agenda,
  onOpenItem,
  onAddSomething,
}: {
  agenda: DailyAgenda | null;
  onOpenItem?: (item: DailyAgendaItem) => void;
  onAddSomething?: () => void;
}) {
  // Home cleanup (Daily Reflection & Tomorrow Preview V1 follow-up) --
  // agenda.nextItem is the exact same canonical "what's next" DailyAgenda
  // already computes (and the same value deriveNextMeaningfulThing's own
  // tier 3 used to read for the now-removed standalone "What's Next"
  // card) -- reused here, not recomputed, to decide which single row gets
  // the NEXT eyebrow.
  const nextItemId = agenda?.nextItem?.id;

  return (
    <section>
      <SectionHeader label="Your Day" right={onAddSomething && <TextButton onClick={onAddSomething}>+ Add something</TextButton>} />
      {!agenda || agenda.items.length === 0 ? (
        <EmptyState
          title="Your day is open"
          description="Aura can help you make room for something meaningful."
          action={onAddSomething ? <TextButton onClick={onAddSomething}>Find something for today →</TextButton> : undefined}
        />
      ) : (
        <div style={{ background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: `0 ${spacing.lg}px` }}>
          {agenda.items.map((item) => (
            <AgendaRow key={item.id} item={item} timezone={agenda.timezone} onOpen={onOpenItem} isNext={item.id === nextItemId} />
          ))}
        </div>
      )}
    </section>
  );
}
