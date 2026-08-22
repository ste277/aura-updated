'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { PanchangDay, PanchangDaySummary, PanchangWindowSpan } from '../../../packages/panchang/src/panchangDay';
import { findWindowOverlaps } from '../../../packages/panchang/src/windowOverlap';
import { getGoodForDayCategories } from '../../../packages/recommendation/src/dayActivitySuggestions';
import { getDatePartsInTimezone } from '../lib/timezone';
import { ExploreModeToggle } from './ExploreModeToggle';

interface PanchangCalendarViewProps {
  timezone: string;
  onBack: () => void;
  /** Only ever called for the current local date -- see section 12 of the
   * brief: a future/past date must never route into a "live" timeline that
   * assumes `now`. */
  onViewTodayRhythm?: () => void;
  onExploreActivities?: () => void;
  /** [Calendar][Muhurtham] toggle entry point (brief section 12). */
  onOpenMuhurtham?: () => void;
  /** External date-jump target, e.g. Muhurtham Finder's "View full Panchang
   * -> " (brief section 14) -- must land on THIS SAME calendar/day-detail
   * implementation, not a second one. Bump initialSelectedDateKey (e.g.
   * Date.now()) alongside a new initialSelectedDate to force re-navigation
   * even to a date that's already selected. */
  initialSelectedDate?: string;
  initialSelectedDateKey?: number;
}

const WEEKDAY_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FAVORABLE_WINDOW_TYPES = new Set(['BRAHMA', 'ABHIJIT']);
const CAUTION_WINDOW_TYPES = new Set(['RAHU_KALAM', 'YAMA', 'GULIKA']);
const CAUTION_LABEL: Record<string, string> = {
  RAHU_KALAM: 'Rahu Kalam',
  YAMA: 'Yamagandam',
  GULIKA: 'Gulika Kalam',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateStr(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** Monday-first grid offset: how many empty leading cells before the 1st. */
export function leadingOffsetForMonth(year: number, month: number): number {
  const jsWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  return (jsWeekday + 6) % 7; // 0=Mon..6=Sun
}

function formatClockTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

function formatFullDateLabel(dateStr: string, timezone: string): string {
  // Interpret dateStr as a local calendar date (not UTC midnight) by reading
  // it back through a noon instant in the target timezone -- consistent
  // with the day/month APIs' own local-date handling.
  const [y, m, d] = dateStr.split('-').map(Number);
  const approxNoonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return approxNoonUTC.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' });
}

export function PanchangCalendarView({ timezone, onBack, onViewTodayRhythm, onExploreActivities, onOpenMuhurtham, initialSelectedDate, initialSelectedDateKey }: PanchangCalendarViewProps) {
  const todayParts = useMemo(() => getDatePartsInTimezone(timezone, new Date()), [timezone]);
  const [displayYear, setDisplayYear] = useState(todayParts.year);
  const [displayMonth, setDisplayMonth] = useState(todayParts.month);
  const [selectedDate, setSelectedDate] = useState<string>(todayParts.dateStr);

  useEffect(() => {
    if (!initialSelectedDate) return;
    const [y, m] = initialSelectedDate.split('-').map(Number);
    if (!y || !m) return;
    setDisplayYear(y);
    setDisplayMonth(m);
    setSelectedDate(initialSelectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedDateKey]);

  const [monthSummaries, setMonthSummaries] = useState<PanchangDaySummary[] | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState('');

  const [dayDetail, setDayDetail] = useState<PanchangDay | null>(null);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMonthLoading(true);
    setMonthError('');
    fetch(`/api/panchang/month?year=${displayYear}&month=${displayMonth}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Unable to load this month.');
        return res.json();
      })
      .then((data: { days: PanchangDaySummary[] }) => {
        if (cancelled) return;
        setMonthSummaries(data.days);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMonthSummaries(null);
        setMonthError(err.message);
      })
      .finally(() => {
        if (!cancelled) setMonthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [displayYear, displayMonth]);

  useEffect(() => {
    let cancelled = false;
    setDayLoading(true);
    setDayError('');
    fetch(`/api/panchang?date=${selectedDate}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Unable to load this date.');
        return res.json();
      })
      .then((data: PanchangDay) => {
        if (cancelled) return;
        setDayDetail(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setDayDetail(null);
        setDayError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const handlePrevMonth = () => {
    if (displayMonth === 1) {
      setDisplayYear((y) => y - 1);
      setDisplayMonth(12);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 12) {
      setDisplayYear((y) => y + 1);
      setDisplayMonth(1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setDisplayYear(todayParts.year);
    setDisplayMonth(todayParts.month);
    setSelectedDate(todayParts.dateStr);
  };

  const daysInMonth = new Date(Date.UTC(displayYear, displayMonth, 0)).getUTCDate();
  const leadingOffset = leadingOffsetForMonth(displayYear, displayMonth);
  const summaryByDate = useMemo(() => {
    const map = new Map<string, PanchangDaySummary>();
    (monthSummaries ?? []).forEach((s) => map.set(s.date, s));
    return map;
  }, [monthSummaries]);

  const isCurrentMonthView = displayYear === todayParts.year && displayMonth === todayParts.month;
  const isSelectedDateToday = selectedDate === todayParts.dateStr;

  const overlaps = useMemo(() => (dayDetail ? findWindowOverlaps(dayDetail.windows) : []), [dayDetail]);
  const overlapsFor = (type: string): PanchangWindowSpan[] => overlaps.find((o) => o.window.type === type)?.overlaps ?? [];
  const goodForDay = useMemo(() => (dayDetail ? getGoodForDayCategories(dayDetail) : []), [dayDetail]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="Back to You" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          You
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Panchang Calendar</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>What the day holds -- Tithi, Nakshatra, and solar timing windows.</p>
        </div>
      </div>

      {onOpenMuhurtham && <ExploreModeToggle active="calendar" onSelectMuhurtham={onOpenMuhurtham} />}

      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={handlePrevMonth} aria-label="Previous month" style={monthNavButtonStyle}>‹</button>
            <span style={{ fontSize: 16, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{MONTH_NAMES[displayMonth - 1]} {displayYear}</span>
            <button type="button" onClick={handleNextMonth} aria-label="Next month" style={monthNavButtonStyle}>›</button>
          </div>
          <button type="button" onClick={handleToday} disabled={isCurrentMonthView && isSelectedDateToday} style={{ ...todayButtonStyle, opacity: isCurrentMonthView && isSelectedDateToday ? 0.5 : 1 }}>
            Today
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 10, fontFamily: 'var(--as-font-mono)', color: '#64748b', fontWeight: 700, marginBottom: 8 }}>
          {WEEKDAY_HEADER.map((label) => <span key={label}>{label}</span>)}
        </div>

        {monthLoading ? (
          <CalendarSkeleton />
        ) : monthError ? (
          <div style={errorBoxStyle}>{monthError}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
            {Array.from({ length: leadingOffset }, (_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const dateStr = toDateStr(displayYear, displayMonth, day);
              const summary = summaryByDate.get(dateStr);
              const isSelected = selectedDate === dateStr;
              const isToday = dateStr === todayParts.dateStr;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  aria-pressed={isSelected}
                  aria-label={`${dateStr}${summary ? `, ${summary.nakshatra.name}` : ''}${isToday ? ', today' : ''}`}
                  style={{
                    ...dayCellStyle,
                    background: isSelected ? '#4ade80' : 'transparent',
                    color: isSelected ? '#020617' : '#f8fafc',
                    border: isSelected ? 'none' : isToday ? '1px solid rgba(74, 222, 128, 0.55)' : '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 12 }}>{day}</span>
                  {summary && (
                    <span style={{ fontSize: 8, marginTop: 2, color: isSelected ? '#065f46' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {summary.nakshatra.name}
                    </span>
                  )}
                  {summary?.moonPhaseMarker && (
                    <span aria-hidden="true" style={{ position: 'absolute', top: 2, right: 3, fontSize: 8 }}>
                      {summary.moonPhaseMarker === 'FULL_MOON' ? '🌕' : '🌑'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {dayLoading ? (
        <section style={cardStyle}><DetailSkeleton /></section>
      ) : dayError ? (
        <section style={cardStyle}><div style={errorBoxStyle}>{dayError}</div></section>
      ) : dayDetail ? (
        <PanchangDayDetail
          day={dayDetail}
          timezone={timezone}
          isToday={isSelectedDateToday}
          overlapsFor={overlapsFor}
          goodForDay={goodForDay}
          onViewTodayRhythm={isSelectedDateToday ? onViewTodayRhythm : undefined}
          onExploreActivities={onExploreActivities}
        />
      ) : null}
    </div>
  );
}

function PanchangDayDetail({
  day,
  timezone,
  isToday,
  overlapsFor,
  goodForDay,
  onViewTodayRhythm,
  onExploreActivities,
}: {
  day: PanchangDay;
  timezone: string;
  isToday: boolean;
  overlapsFor: (type: string) => PanchangWindowSpan[];
  goodForDay: ReturnType<typeof getGoodForDayCategories>;
  onViewTodayRhythm?: () => void;
  onExploreActivities?: () => void;
}) {
  const favorableWindows = day.windows.filter((w) => FAVORABLE_WINDOW_TYPES.has(w.type));
  const cautionWindows = day.windows.filter((w) => CAUTION_WINDOW_TYPES.has(w.type));

  return (
    <>
      <section style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{formatFullDateLabel(day.date, timezone)}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{day.location.timezone}</div>
          </div>
          {isToday && <span style={todayBadgeStyle}>Today</span>}
        </div>

        <div style={sectionKickerStyle}>Panchang</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          {/* tithi.name already includes the paksha prefix where relevant
              (e.g. "Shukla Panchami"; "Purnima"/"Amavasya" have none) --
              .paksha is a separate structured field for callers that want
              to branch on it, not something to prepend here. */}
          <PanchangaCell label="Tithi" value={day.panchanga.tithi.name} endsAt={day.panchanga.tithi.endsAt} timezone={timezone} />
          <PanchangaCell label="Nakshatra" value={day.panchanga.nakshatra.name} endsAt={day.panchanga.nakshatra.endsAt} timezone={timezone} />
          <PanchangaCell label="Yoga" value={day.panchanga.yoga.name} endsAt={day.panchanga.yoga.endsAt} timezone={timezone} />
          <PanchangaCell label="Karana" value={day.panchanga.karana.name} endsAt={day.panchanga.karana.endsAt} timezone={timezone} />
          <PanchangaCell label="Vara" value={day.panchanga.vara} endsAt={null} timezone={timezone} />
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ ...sectionKickerStyle, color: '#4ade80' }}>✨ Favorable periods</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {favorableWindows.map((w) => (
            <WindowRow key={w.type} window={w} timezone={timezone} accent="#4ade80" overlaps={overlapsFor(w.type)} />
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ ...sectionKickerStyle, color: '#fb6b6b' }}>⚠ Caution periods</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {cautionWindows.map((w) => (
            <WindowRow key={w.type} window={w} timezone={timezone} accent="#fb6b6b" label={CAUTION_LABEL[w.type]} overlaps={overlapsFor(w.type)} />
          ))}
        </div>
      </section>

      {goodForDay.length > 0 && (
        <section style={cardStyle}>
          <div style={{ ...sectionKickerStyle, color: '#a78bfa' }}>✨ Good for this day</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {goodForDay.map((category) => (
              <span key={category.activityId} style={goodForDayChipStyle}>
                {category.icon} {category.label}
              </span>
            ))}
          </div>
          {onExploreActivities && (
            <button type="button" onClick={onExploreActivities} style={{ ...linkButtonStyle, marginTop: 12 }}>
              Explore activities →
            </button>
          )}
        </section>
      )}

      {onViewTodayRhythm && (
        <button type="button" onClick={onViewTodayRhythm} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
          View today&apos;s rhythm →
        </button>
      )}
    </>
  );
}

function PanchangaCell({ label, value, endsAt, timezone }: { label: string; value: string; endsAt: string | null; timezone: string }) {
  return (
    <div style={panchangaCellStyle}>
      <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'var(--as-font-mono)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>{value}</div>
      {endsAt && (
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>until {formatClockTime(endsAt, timezone)}</div>
      )}
    </div>
  );
}

function WindowRow({ window, timezone, accent, label, overlaps }: { window: PanchangWindowSpan; timezone: string; accent: string; label?: string; overlaps: PanchangWindowSpan[] }) {
  return (
    <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{label ?? window.label}</div>
      <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 2 }}>
        {formatClockTime(window.start, timezone)} – {formatClockTime(window.end, timezone)}
      </div>
      {overlaps.length > 0 && (
        <div style={{ fontSize: 11, color: '#facc15', marginTop: 4 }}>
          ⚠ overlaps {overlaps.map((o) => o.label).join(', ')} ({overlaps.map((o) => `${formatClockTime(o.start, timezone)}–${formatClockTime(o.end, timezone)}`).join(', ')})
        </div>
      )}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
      {Array.from({ length: 35 }, (_, i) => (
        <div key={i} style={{ aspectRatio: '1', borderRadius: 8, background: 'rgba(148, 163, 184, 0.08)' }} />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ height: 20, width: '60%', borderRadius: 6, background: 'rgba(148, 163, 184, 0.1)' }} />
      <div style={{ height: 60, borderRadius: 10, background: 'rgba(148, 163, 184, 0.08)' }} />
      <div style={{ height: 60, borderRadius: 10, background: 'rgba(148, 163, 184, 0.08)' }} />
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--as-surface-raised, #0f172a)',
  border: '1px solid var(--as-border, #1e293b)',
  borderRadius: 16,
  padding: 16,
};

const backButtonStyle: React.CSSProperties = {
  minHeight: 34,
  borderRadius: 17,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#f8fafc',
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px',
  fontWeight: 800,
};

const monthNavButtonStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  color: '#fff',
  borderRadius: 8,
  width: 30,
  height: 30,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
};

const todayButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: '1px solid rgba(74, 222, 128, 0.3)',
  borderRadius: 10,
  background: 'rgba(74, 222, 128, 0.1)',
  color: '#4ade80',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
  padding: '0 12px',
};

const dayCellStyle: React.CSSProperties = {
  aspectRatio: '1',
  borderRadius: 8,
  fontFamily: 'sans-serif',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  padding: 2,
  minWidth: 0,
};

const sectionKickerStyle: React.CSSProperties = {
  color: '#4ade80',
  fontSize: 11,
  fontFamily: 'var(--as-font-mono)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginTop: 4,
};

const panchangaCellStyle: React.CSSProperties = {
  background: 'rgba(2, 6, 23, 0.4)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  borderRadius: 10,
  padding: '9px 11px',
};

const errorBoxStyle: React.CSSProperties = {
  color: '#fb6b6b',
  fontSize: 12,
  lineHeight: 1.45,
  padding: '12px 4px',
  textAlign: 'center',
};

const todayBadgeStyle: React.CSSProperties = {
  border: '1px solid rgba(74, 222, 128, 0.35)',
  borderRadius: 999,
  color: '#4ade80',
  background: 'rgba(74, 222, 128, 0.1)',
  padding: '2px 8px',
  fontSize: 10,
  fontWeight: 850,
};

const goodForDayChipStyle: React.CSSProperties = {
  border: '1px solid rgba(167, 139, 250, 0.35)',
  borderRadius: 999,
  background: 'rgba(167, 139, 250, 0.1)',
  color: '#e4defb',
  padding: '6px 11px',
  fontSize: 12,
  fontWeight: 750,
};

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#38bdf8',
  fontSize: 14,
  fontWeight: 850,
  cursor: 'pointer',
  padding: 0,
};
