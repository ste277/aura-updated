'use client';

import { useEffect, useState } from 'react';
import { PastActivityModal } from './PastActivityModal';

interface DayActivity {
  day: number;
  count: number;
}

interface DayLogEntry {
  id: string;
  activityTitle: string;
  activeWindow: string;
  logTimestamp: string;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [activity, setActivity] = useState<DayActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Default selected day to TODAY (if viewing current month/year)
  const [selectedDay, setSelectedDay] = useState<number>(now.getDate());
  const [dayLogs, setDayLogs] = useState<DayLogEntry[] | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  // State for PastActivityModal
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch month activity counts
  const fetchMonthActivity = () => {
    setLoading(true);
    fetch(`/api/habit-logs/calendar?year=${year}&month=${month}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setActivity(data))
      .catch((err) => console.error('Error fetching calendar activity:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMonthActivity();
  }, [year, month]);

  // Fetch logs for the selected day automatically
  const fetchLogsForDay = async (targetDay: number) => {
    setDayLoading(true);
    try {
      const res = await fetch(`/api/habit-logs/calendar/day?year=${year}&month=${month}&day=${targetDay}`);
      if (res.ok) {
        const data = await res.json();
        setDayLogs(data);
      }
    } catch (err) {
      console.error('Error fetching day logs:', err);
    } finally {
      setDayLoading(false);
    }
  };

  useEffect(() => {
    fetchLogsForDay(selectedDay);
  }, [year, month, selectedDay]);

  const handleActivityLogged = () => {
    fetchLogsForDay(selectedDay);
    fetchMonthActivity();
  };

  function goToPrevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function handleDayClick(day: number) {
    setSelectedDay(day);
  }

  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = firstOfMonth.getDay();

  const activityByDay = new Map(activity.map((a) => [a.day, a.count]));
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const today = now.getDate();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedDateObj = new Date(year, month - 1, selectedDay);

  return (
    <div style={{ marginTop: 28, position: 'relative' }}>
      {/* Calendar Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button type="button" onClick={goToPrevMonth} style={navButtonStyle}>
          ‹
        </button>
        <span style={{ fontFamily: 'var(--as-font-mono)', fontSize: 12, color: 'var(--as-text-muted)' }}>
          {MONTH_NAMES[month - 1]} {year}
          {loading ? ' …' : ''}
        </span>
        <button type="button" onClick={goToNextMonth} style={navButtonStyle}>
          ›
        </button>
      </div>

      {/* Weekday Header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--as-text-muted)', fontFamily: 'var(--as-font-mono)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const count = activityByDay.get(day) ?? 0;
          const isToday = isCurrentMonth && day === today;
          const isSelected = day === selectedDay;

          return (
            <button
              type="button"
              key={i}
              onClick={() => handleDayClick(day)}
              title={count > 0 ? `${count} logged` : 'No activity'}
              style={{
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'var(--as-font-mono)',
                border: isSelected
                  ? '2px solid var(--as-text, #ffffff)'
                  : isToday
                  ? '1px solid var(--as-abhijit, #4ade80)'
                  : '1px solid transparent',
                background: count > 0 ? 'var(--as-abhijit-dim, #1f4d34)' : 'var(--as-surface-raised)',
                color: count > 0 ? 'var(--as-abhijit, #4ade80)' : 'var(--as-text-muted)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Embedded Activity List Below Calendar for the Selected Date */}
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between', // Fixed style bug here
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontFamily: 'var(--as-font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--as-text-muted)' }}>
            Activity Log ({MONTH_NAMES[month - 1]} {selectedDay}, {year})
          </span>

          {/* Connected "+ Log Activity" Button */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            style={{
              background: 'var(--as-abhijit, #4ade80)',
              color: '#000000',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--as-font-mono)',
              cursor: 'pointer',
            }}
          >
            + Log Activity
          </button>
        </div>

        {dayLoading && <div style={{ fontSize: 12, color: 'var(--as-text-muted)', fontFamily: 'var(--as-font-mono)' }}>Loading day logs…</div>}

        {!dayLoading && dayLogs && dayLogs.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--as-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
            No activities logged for this day.
          </div>
        )}

        {!dayLoading && dayLogs && dayLogs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dayLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between', // Fixed style bug here
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--as-text)', fontWeight: 500 }}>{log.activityTitle}</span>
                <span style={{ color: 'var(--as-text-muted)', fontFamily: 'var(--as-font-mono)', fontSize: 12 }}>
                  {new Date(log.logTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Render Modal */}
      <PastActivityModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedDateObj}
        onSuccess={handleActivityLogged}
      />
    </div>
  );
}

const navButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--as-text-muted)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 8px',
};
