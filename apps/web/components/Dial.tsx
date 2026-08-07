'use client';

import React from 'react';
import type { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';
import { getCountdown, formatCountdown } from '../lib/countdown';

interface DialProps {
  windows: WindowSpan[];
  currentMinuteOfDay: number;
  currentSecondOfDay: number;
  selectedType: SolarWindowType | null;
  activeType: SolarWindowType;
  onSelectWindow: (type: SolarWindowType | null) => void;
}

const CENTER = 180;
const RADIUS = 115;
const STROKE = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const COLOR_MAP: Record<SolarWindowType, string> = {
  BRAHMA: 'var(--as-brahma, #f97316)',
  ABHIJIT: 'var(--as-abhijit, #22c55e)',
  RAHU_KALAM: 'var(--as-rahu, #ef4444)',
  GULIKA: 'var(--as-gulika, #a855f7)',
  YAMA: 'var(--as-yama, #eab308)',
  NEUTRAL: 'var(--as-neutral-arc, #1e293b)',
};

function minuteToDegrees(minute: number): number {
  return (minute / 1440) * 360 - 90;
}

function polarPoint(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function formatHM(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function Dial({
  windows,
  currentMinuteOfDay,
  currentSecondOfDay,
  selectedType,
  activeType,
  onSelectWindow,
}: DialProps) {
  const nowDeg = minuteToDegrees(currentMinuteOfDay);
  const nowPoint = polarPoint(CENTER, CENTER, RADIUS, nowDeg);
  const countdown = getCountdown(windows, currentSecondOfDay, activeType);

  const hourTicks = Array.from({ length: 24 }, (_, h) => {
    const deg = minuteToDegrees(h * 60);
    const inner = polarPoint(CENTER, CENTER, RADIUS - STROKE / 2 - 4, deg);
    const outer = polarPoint(CENTER, CENTER, RADIUS - STROKE / 2 - 10, deg);
    const labelPos = polarPoint(CENTER, CENTER, RADIUS + STROKE / 2 + 16, deg);
    return { h, inner, outer, labelPos };
  });

  const selectedWindow = selectedType ? windows.find((w) => w.type === selectedType) : null;

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 360, margin: '0 auto' }}>
      <svg
        viewBox="0 0 360 360"
        role="img"
        aria-label="24-hour solar timing dial"
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: selectedType ? 'pointer' : 'default' }}
        // Clicking anywhere outside the arcs resets selected window
        onClick={() => onSelectWindow(null)}
      >
        {/* Base Track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="#131b2e"
          strokeWidth={STROKE}
        />

        {/* Solar Window Segments */}
        {windows.map((w) => {
          let start = w.startMinutes;
          let end = w.endMinutes;
          if (end < start) end += 1440;

          const spanMinutes = end - start;
          if (spanMinutes <= 0) return null;

          const arcLength = (spanMinutes / 1440) * CIRCUMFERENCE;
          const startRatio = w.startMinutes / 1440;
          const dashOffset = CIRCUMFERENCE * (0.25 - startRatio);

          const isSelected = selectedType === w.type;
          const color = COLOR_MAP[w.type] ?? '#3b82f6';

          return (
            <circle
              key={`${w.type}-${w.startMinutes}`}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeDasharray={`${arcLength} ${CIRCUMFERENCE - arcLength}`}
              strokeDashoffset={dashOffset}
              style={{
                cursor: 'pointer',
                transition: 'opacity 200ms ease',
                opacity: selectedType ? (isSelected ? 1 : 0.2) : 1,
              }}
              onClick={(e) => {
                e.stopPropagation(); // Prevents top-level backdrop click from immediately resetting selection
                onSelectWindow(isSelected ? null : w.type);
              }}
            >
              <title>{w.label}</title>
            </circle>
          );
        })}

        {/* Hour Ticks and Labels */}
        {hourTicks.map(({ h, inner, outer, labelPos }) => (
          <React.Fragment key={h}>
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="#334155"
              strokeWidth={h % 6 === 0 ? 2 : 1}
              pointerEvents="none"
            />
            {h % 3 === 0 && (
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#94a3b8"
                fontFamily="var(--as-font-mono, monospace)"
                fontSize="11"
                pointerEvents="none"
              >
                {String(h).padStart(2, '0')}
              </text>
            )}
          </React.Fragment>
        ))}

        {/* Live Indicator Node */}
        <circle
          cx={nowPoint.x}
          cy={nowPoint.y}
          r={8}
          fill="#ffffff"
          stroke="#09090b"
          strokeWidth={3}
          pointerEvents="none"
          style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.8))' }}
        />

        {/* Center Display */}
        <g pointerEvents="none">
          <text
            x={CENTER}
            y={CENTER - 36}
            textAnchor="middle"
            fill="#94a3b8"
            fontFamily="var(--as-font-mono, monospace)"
            fontSize="10"
            letterSpacing="0.1em"
          >
            {selectedType ? 'SELECTED WINDOW' : 'CURRENT WINDOW'}
          </text>

          <text
            x={CENTER}
            y={CENTER + 2}
            textAnchor="middle"
            fill="#ffffff"
            fontFamily="var(--as-font-mono, monospace)"
            fontSize="28"
            fontWeight="700"
            letterSpacing="-0.02em"
          >
            {String(Math.floor(currentMinuteOfDay / 60)).padStart(2, '0')}:
            {String(currentMinuteOfDay % 60).padStart(2, '0')}
          </text>

          {/* Selected Window Detail */}
          {selectedType && selectedWindow ? (
            <g>
              <text
                x={CENTER}
                y={CENTER + 24}
                textAnchor="middle"
                fill={COLOR_MAP[selectedType] ?? '#38bdf8'}
                fontFamily="var(--as-font-mono, monospace)"
                fontSize="11"
                fontWeight="600"
              >
                {selectedWindow.label}
              </text>
              <text
                x={CENTER}
                y={CENTER + 38}
                textAnchor="middle"
                fill="#94a3b8"
                fontFamily="var(--as-font-mono, monospace)"
                fontSize="10"
              >
                {formatHM(selectedWindow.startMinutes)} – {formatHM(selectedWindow.endMinutes)}
              </text>
            </g>
          ) : countdown ? (
            /* Live Countdown View */
            <g>
              {countdown.windowLabel && activeType === 'NEUTRAL' ? (
                <>
                  <text
                    x={CENTER}
                    y={CENTER + 24}
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontFamily="var(--as-font-mono, monospace)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {countdown.windowLabel}
                  </text>
                  <text
                    x={CENTER}
                    y={CENTER + 38}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontFamily="var(--as-font-mono, monospace)"
                    fontSize="10"
                  >
                    {countdown.label} {formatCountdown(countdown.secondsRemaining)}
                  </text>
                </>
              ) : (
                <text
                  x={CENTER}
                  y={CENTER + 30}
                  textAnchor="middle"
                  fill={COLOR_MAP[activeType] ?? '#38bdf8'}
                  fontFamily="var(--as-font-mono, monospace)"
                  fontSize="11"
                  fontWeight="500"
                >
                  {countdown.label} {formatCountdown(countdown.secondsRemaining)}
                </text>
              )}
            </g>
          ) : (
            <text
              x={CENTER}
              y={CENTER + 30}
              textAnchor="middle"
              fill="#94a3b8"
              fontFamily="var(--as-font-body, sans-serif)"
              fontSize="11"
            >
              tap an arc
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}