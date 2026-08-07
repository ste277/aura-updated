'use client';

import type { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';
import { COLOR_BY_TYPE } from '../lib/windowColors';

interface DayTimelineProps {
  windows: WindowSpan[];
  sunriseMinutes: number;
  sunsetMinutes: number;
  currentMinuteOfDay: number;
  selectedType: SolarWindowType | null;
  activeType: SolarWindowType;
  onSelectWindow: (type: SolarWindowType) => void;
}

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21]; // every 3 hours

function pct(minute: number): number {
  return (minute / 1440) * 100;
}

function formatHM(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function DayTimeline({
  windows,
  sunriseMinutes,
  sunsetMinutes,
  currentMinuteOfDay,
  selectedType,
  activeType,
  onSelectWindow,
}: DayTimelineProps) {
  const displayedType = selectedType ?? activeType;
  const selectedWindow = windows.find((w) => w.type === displayedType);

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          fontFamily: 'var(--as-font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--as-text-muted)',
          marginBottom: 10,
        }}
      >
        Today's panchang timeline
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 11, color: 'var(--as-text-muted)' }}>
        {(
          [
            ['BRAHMA', 'Brahma'],
            ['ABHIJIT', 'Abhijit'],
            ['RAHU_KALAM', 'Rahu Kalam'],
            ['GULIKA', 'Gulika'],
            ['YAMA', 'Yama'],
          ] as [SolarWindowType, string][]
        ).map(([type, label]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: COLOR_BY_TYPE[type], display: 'inline-block' }} />
            {label}
          </div>
        ))}
      </div>

      {/* Bar */}
      <div style={{ position: 'relative', height: 34, borderRadius: 8, overflow: 'hidden', background: 'var(--as-neutral-arc)' }}>
        {windows.map((w) => {
          const wraps = w.endMinutes < w.startMinutes;
          const isActive = w.type === activeType;
          const isSelected = selectedType === w.type;
          const segments = wraps
            ? [
                { start: w.startMinutes, end: 1440 },
                { start: 0, end: w.endMinutes },
              ]
            : [{ start: w.startMinutes, end: w.endMinutes }];

          return segments.map((seg, i) => (
            <div
              key={`${w.type}-${i}`}
              title={`${w.label}`}
              onClick={() => onSelectWindow(w.type)}
              style={{
                position: 'absolute',
                left: `${pct(seg.start)}%`,
                width: `${pct(seg.end - seg.start)}%`,
                top: 0,
                bottom: 0,
                background: COLOR_BY_TYPE[w.type],
                cursor: 'pointer',
                opacity: selectedType && !isSelected ? 0.35 : 1,
                outline: isActive || isSelected ? '2px solid var(--as-text, #ffffff)' : 'none',
                outlineOffset: -2,
                transition: 'opacity 200ms ease, outline 200ms ease',
              }}
            />
          ));
        })}

        {/* Now marker */}
        <div
          style={{
            position: 'absolute',
            left: `${pct(currentMinuteOfDay)}%`,
            top: -3,
            bottom: -3,
            width: 2,
            background: 'var(--as-text)',
            boxShadow: '0 0 4px var(--as-text)',
            zIndex: 5,
          }}
        />

        {/* Sunrise / sunset markers */}
        <div
          style={{
            position: 'absolute',
            left: `${pct(sunriseMinutes)}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 12,
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 10,
          }}
          title={`Sunrise: ${formatHM(sunriseMinutes)}`}
        >
          ☀️
        </div>
        <div
          style={{
            position: 'absolute',
            left: `${pct(sunsetMinutes)}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 12,
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 10,
          }}
          title={`Sunset: ${formatHM(sunsetMinutes)}`}
        >
          🌇
        </div>
      </div>

      {/* Hour labels */}
      <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
        {HOUR_TICKS.map((h) => (
          <span
            key={h}
            style={{
              position: 'absolute',
              left: `${pct(h * 60)}%`,
              transform: 'translateX(-50%)',
              fontSize: 10,
              fontFamily: 'var(--as-font-mono)',
              color: 'var(--as-text-muted)',
            }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--as-text-muted)', marginTop: 6 }}>
        Tap any segment to see details · showing:{' '}
        <strong style={{ color: 'var(--as-text)' }}>
          {selectedWindow ? `${selectedWindow.label} (${formatHM(selectedWindow.startMinutes)} - ${formatHM(selectedWindow.endMinutes)})` : 'Neutral'}
        </strong>
      </div>
    </div>
  );
}