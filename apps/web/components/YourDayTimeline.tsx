'use client';

import React from 'react';
import type { DailyAgenda, DailyAgendaItem } from '../lib/dailyAgenda';
import { formatActivityDuration } from '../lib/activityDuration';
import { selectCompactAgendaRows, groupAdjacentByFormattedTime } from '../lib/compactAgenda';
import { colors, spacing, radius, typography } from './theme';
import { SectionHeader, TextButton, EmptyState } from './ui';

/**
 * My Day V1 (brief section 8/36) -- "Your Day": one clean chronological
 * list, not a grid of independent large cards. Past/completed items are
 * subdued, the current item is slightly emphasized, starting-soon gets a
 * subtle accent, everything else is normal weight -- brief section 8's
 * exact visual-treatment ladder, implemented as row styling, not a fifth
 * card type.
 *
 * Home Compactness + Flexible Day Story V1 (brief section 4/7/8) -- Home
 * itself now renders only a small, compact selection of rows
 * (selectCompactAgendaRows), never the full unbounded list. "View all N"
 * routes to the EXISTING full-day timeline (onViewAll, wired to the same
 * destination HomeDashboard's other "View full day" links already use) --
 * this component gains no new expand-inline state and no new screen.
 */

function formatRawTime(item: DailyAgendaItem, timezone: string): string {
  return new Date(item.startAt).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

function formatItemTime(item: DailyAgendaItem, timezone: string): string {
  const time = formatRawTime(item, timezone);
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

/** Home Compactness + Flexible Day Story V1 (brief section 10) -- audit
 * found the real source of stray internal text like "focus"/"workout"
 * appearing where an icon glyph should be: `Plan.icon` is sometimes
 * populated by `planIconForTitle()` (PlanWithAuraView.tsx), which returns
 * an internal `PlanIcon` CATEGORY id ('focus'/'workout'/'study'/'heart'/
 * 'meditate'/'meeting'/'journey') meant for that component's own local
 * icon lookup -- never an emoji -- but `saveUpcomingPlanFromCandidate()`
 * (the canonical Plan-creation path Day Builder's Add and every Timing
 * Search "Use this time" call through) stores that raw category string
 * verbatim as `Plan.icon`, and this file's own `itemMarker()` used to
 * render whatever `item.icon` held with no check at all. A genuine emoji
 * is never plain ASCII letters, so this is a general, forward-compatible
 * guard (not a hardcoded list of the 7 known category ids) rather than a
 * fix to the underlying category-id storage, which is a separate,
 * PlanWithAuraView-owned concern out of this brief's scope (brief section
 * 63: do not change unrelated domain behavior). */
function isDisplayableIcon(icon: string): boolean {
  return !/^[a-zA-Z]+$/.test(icon);
}

function itemMarker(item: DailyAgendaItem): string {
  if (item.status === 'COMPLETED') return '✓';
  // Brief section 3/4 (Daily Reflection & Tomorrow Preview V1): a MISSED
  // item is a calm, plain fact -- a faint dash, never a warning glyph.
  if (item.status === 'MISSED') return '–';
  if (item.status === 'CURRENT') return '●';
  if (item.status === 'WAITING') return '◌';
  if (item.icon && isDisplayableIcon(item.icon)) return item.icon;
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

function GroupedCompletedRows({ items, timezone, onOpen }: { items: DailyAgendaItem[]; timezone: string; onOpen?: (item: DailyAgendaItem) => void }) {
  const groups = groupAdjacentByFormattedTime(items, (item) => formatRawTime(item, timezone));
  return (
    <>
      {groups.map((group) =>
        group.items.length === 1 ? (
          <AgendaRow key={group.items[0].id} item={group.items[0]} timezone={timezone} onOpen={onOpen} />
        ) : (
          // Brief section 9 -- several genuinely-distinct completions that
          // happen to share the same displayed minute: one time header,
          // not several rows that falsely imply they happened in sequence.
          <div key={`group:${group.timeLabel}:${group.items[0].id}`} style={{ padding: `${spacing.sm}px 0`, borderBottom: `1px solid ${colors.borderSubtle}` }}>
            <div style={{ ...typography.meta, color: colors.textMuted, marginBottom: 4 }}>{group.timeLabel}</div>
            {group.items.map((item) => {
              const title = item.type === 'MOMENT' && item.participantDisplayName ? `${item.title} with ${item.participantDisplayName}` : item.title;
              const Wrapper = onOpen ? 'button' : 'div';
              return (
                <Wrapper
                  key={item.id}
                  type={onOpen ? 'button' : undefined}
                  onClick={onOpen ? () => onOpen(item) : undefined}
                  style={{ display: 'grid', gridTemplateColumns: '24px 1fr', alignItems: 'center', gap: spacing.md, width: '100%', padding: '3px 0', background: 'transparent', border: 'none', textAlign: 'left', cursor: onOpen ? 'pointer' : 'default', opacity: 0.6 }}
                >
                  <span aria-hidden="true" style={{ color: colors.positive, fontSize: 15, textAlign: 'center' }}>✓</span>
                  <span style={{ ...typography.bodyStrong, fontWeight: 700, textDecoration: 'line-through', textDecorationColor: colors.borderDefault, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                </Wrapper>
              );
            })}
          </div>
        )
      )}
    </>
  );
}

export function YourDayTimeline({
  agenda,
  onOpenItem,
  onAddSomething,
  onViewAll,
}: {
  agenda: DailyAgenda | null;
  onOpenItem?: (item: DailyAgendaItem) => void;
  onAddSomething?: () => void;
  /** Home Compactness + Flexible Day Story V1 (brief section 7) -- routes
   * to the EXISTING full-day timeline. Omitted entirely means "View all"
   * simply doesn't render (no dead link), never a new inline-expand state. */
  onViewAll?: () => void;
}) {
  // Home cleanup (Daily Reflection & Tomorrow Preview V1 follow-up) --
  // agenda.nextItem is the exact same canonical "what's next" DailyAgenda
  // already computes (and the same value deriveNextMeaningfulThing's own
  // tier 3 used to read for the now-removed standalone "What's Next"
  // card) -- reused here, not recomputed, to decide which single row gets
  // the NEXT eyebrow.
  const nextItemId = agenda?.nextItem?.id;
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  const completedRows = rows.filter((item) => item.status === 'COMPLETED');
  const otherRows = rows.filter((item) => item.status !== 'COMPLETED');
  const totalCount = agenda?.items.length ?? 0;

  return (
    <section>
      <SectionHeader
        label="Your Day"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
            {onAddSomething && <TextButton onClick={onAddSomething}>+ Add something</TextButton>}
            {onViewAll && totalCount > 0 && <TextButton onClick={onViewAll}>View all {totalCount} →</TextButton>}
          </div>
        }
      />
      {!agenda || agenda.items.length === 0 ? (
        <EmptyState
          title="Your day is open"
          description="Aura can help you make room for something meaningful."
          action={onAddSomething ? <TextButton onClick={onAddSomething}>Find something for today →</TextButton> : undefined}
        />
      ) : (
        <div style={{ background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: `0 ${spacing.lg}px` }}>
          {completedRows.length > 0 && <GroupedCompletedRows items={completedRows} timezone={agenda.timezone} onOpen={onOpenItem} />}
          {otherRows.map((item) => (
            <AgendaRow key={item.id} item={item} timezone={agenda.timezone} onOpen={onOpenItem} isNext={item.id === nextItemId} />
          ))}
          {hiddenCount > 0 && (
            <div style={{ ...typography.caption, color: colors.textMuted, padding: `${spacing.sm}px 0`, textAlign: 'center' }}>
              {onViewAll ? (
                <TextButton onClick={onViewAll} color={colors.textMuted}>+ {hiddenCount} earlier {hiddenCount === 1 ? 'activity' : 'activities'}</TextButton>
              ) : (
                <>+ {hiddenCount} earlier {hiddenCount === 1 ? 'activity' : 'activities'}</>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
