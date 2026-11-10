'use client';

import React, { useState } from 'react';
import type { PalmistryEntry, PalmistryEntryId } from '../../../packages/palmistry/src/content';
import { colors } from './theme';

/**
 * AURA-PALM-01-I1 -- an ORIGINAL, schematic inline-SVG right palm drawn for
 * Aura (no copied diagram, no image file, no canvas, no dependency).
 *
 * Orientation: a right hand seen from the palm side, so the thumb is on
 * the viewer's right and the little finger on the left. Line paths follow
 * the sources' VERBAL descriptions (Zysk 2025 commentary; Bṛhatsaṃhitā),
 * not any published drawing, and are approximate by design -- see
 * PALMISTRY_DIAGRAM_NOTE. Only entries whose placement is
 * 'described-in-sources' are drawn; marks are never placed on the hand.
 *
 * Accessibility: every line is a focusable role="button" with an accessible
 * name, Enter/Space activation, a drawn focus ring (CSS outlines are
 * unreliable on SVG groups), and a selected state shown by stroke width +
 * end markers, not colour alone. Each line also carries its list number.
 * The diagram is never the only way in: PalmistryView always renders a
 * text list of every entry.
 */

/** Schematic paths, keyed by PalmistryEntry.diagramRegionId. viewBox 0 0 300 400. */
export const PALM_LINE_PATHS: Record<string, { d: string; start: [number, number]; end: [number, number]; label: [number, number] }> = {
  // Top line: from below the little finger toward the forefinger's base.
  'palm-line-ayurlekha': { d: 'M 64 204 C 100 190 148 184 182 178', start: [64, 204], end: [182, 178], label: [44, 196] },
  // Middle line, between the top line and the thumb-base line.
  'palm-line-dhanamatrlekha': { d: 'M 210 210 C 170 222 122 236 84 258', start: [210, 210], end: [84, 258], label: [66, 268] },
  // From the base of the thumb near the wrist toward the thumb–forefinger space.
  'palm-line-pitrlekha': { d: 'M 182 384 C 168 322 172 256 212 216', start: [182, 384], end: [212, 216], label: [196, 340] },
  // From the wrist upward; drawn ending at the middle finger (one possible course).
  'palm-line-urdhvarekha': { d: 'M 146 386 C 148 320 151 244 155 172', start: [146, 386], end: [155, 172], label: [126, 330] },
};

const HAND_OUTLINE =
  'M 82 396 C 70 360 60 322 60 282 L 60 178 ' +
  'L 62 112 Q 77 88 92 112 L 95 166 ' +
  'L 98 72 Q 115 46 132 72 L 135 160 ' +
  'L 138 56 Q 155 30 172 56 L 175 162 ' +
  'L 178 76 Q 194 52 210 76 L 214 184 ' +
  'C 222 200 236 204 248 190 L 268 160 Q 292 148 290 178 ' +
  'L 262 246 C 248 286 228 322 216 346 C 210 366 210 382 212 396 Z';

/** Decorative finger-joint creases (not traditional features). */
const DECORATIVE_CREASES = ['M 66 140 L 90 140', 'M 102 108 L 129 108', 'M 142 94 L 169 94', 'M 182 110 L 207 110', 'M 262 186 L 280 176'];

export interface PalmHandDiagramProps {
  lines: PalmistryEntry[];
  selectedId: PalmistryEntryId | null;
  onSelect: (id: PalmistryEntryId) => void;
}

export function PalmHandDiagram({ lines, selectedId, onSelect }: PalmHandDiagramProps) {
  const [focusedId, setFocusedId] = useState<PalmistryEntryId | null>(null);
  const drawable = lines.filter((entry) => entry.diagramPlacement === 'described-in-sources' && PALM_LINE_PATHS[entry.diagramRegionId]);

  return (
    <svg
      viewBox="0 0 300 400"
      role="group"
      aria-label="Schematic drawing of a right palm. Select a numbered line to read about it."
      data-testid="palm-hand-diagram"
      style={{ width: '100%', maxWidth: 340, height: 'auto', display: 'block', margin: '0 auto', touchAction: 'manipulation' }}
    >
      <title>Schematic right palm with four traditional lines</title>
      <path d={HAND_OUTLINE} fill="rgba(167, 139, 250, 0.06)" stroke={colors.textMuted} strokeWidth={2} strokeLinejoin="round" />
      {DECORATIVE_CREASES.map((d) => (
        <path key={d} d={d} stroke="rgba(148, 163, 184, 0.28)" strokeWidth={1.5} strokeLinecap="round" fill="none" aria-hidden="true" />
      ))}
      {drawable.map((entry, index) => {
        const geometry = PALM_LINE_PATHS[entry.diagramRegionId]!;
        const selected = entry.id === selectedId;
        const focused = entry.id === focusedId;
        const number = index + 1;
        const activate = () => onSelect(entry.id);
        return (
          <g
            key={entry.id}
            id={entry.diagramRegionId}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${number}. ${entry.title}${entry.traditionalName ? ` (${entry.traditionalName})` : ''}`}
            data-entry-id={entry.id}
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                activate();
              }
            }}
            onFocus={() => setFocusedId(entry.id)}
            onBlur={() => setFocusedId((current) => (current === entry.id ? null : current))}
            style={{ cursor: 'pointer', outline: 'none' }}
          >
            {/* Wide invisible hit area: 46 viewBox units ≈ 45px at a 293px-wide phone render (measured at 375px viewport). */}
            <path d={geometry.d} stroke="transparent" strokeWidth={46} fill="none" strokeLinecap="round" pointerEvents="stroke" />
            {focused && (
              <path d={geometry.d} stroke={colors.borderFocus} strokeWidth={14} strokeDasharray="6 5" fill="none" strokeLinecap="round" data-focus-ring="true" />
            )}
            <path
              d={geometry.d}
              stroke={selected ? colors.traditional : colors.textSecondary}
              strokeWidth={selected ? 6 : 3}
              fill="none"
              strokeLinecap="round"
              data-selected={selected ? 'true' : 'false'}
            />
            {selected && (
              <>
                <circle cx={geometry.start[0]} cy={geometry.start[1]} r={6} fill={colors.traditional} />
                <circle cx={geometry.end[0]} cy={geometry.end[1]} r={6} fill="none" stroke={colors.traditional} strokeWidth={3} />
              </>
            )}
            <circle cx={geometry.label[0]} cy={geometry.label[1]} r={11} fill={selected ? colors.traditional : 'rgba(15, 23, 42, 0.9)'} stroke={colors.traditional} strokeWidth={1.5} />
            <text
              x={geometry.label[0]}
              y={geometry.label[1] + 4}
              textAnchor="middle"
              fontSize={12}
              fontWeight={800}
              fill={selected ? colors.textInverse : colors.textPrimary}
              aria-hidden="true"
            >
              {number}
            </text>
          </g>
        );
      })}
      {/* Precise-hit layer, above every wide hit area: a tap directly on a
       * drawn stroke always selects THAT line, even where another line's
       * forgiving 46-unit zone overlaps it (found in real-browser hit
       * testing: the upward line's zone was stealing taps where it crosses
       * the longevity and prosperity lines). The vertical upward line is
       * drawn first so the transverse lines win at an exact crossing.
       * Pointer-only and aria-hidden: keyboard/AT users use the focusable
       * groups above, which already carry the full accessible name. */}
      <g aria-hidden="true">
        {[...drawable]
          .sort((a, b) => (a.id === 'urdhvarekha' ? -1 : b.id === 'urdhvarekha' ? 1 : 0))
          .map((entry) => (
            <path
              key={`precise-${entry.id}`}
              d={PALM_LINE_PATHS[entry.diagramRegionId]!.d}
              stroke="transparent"
              strokeWidth={10}
              fill="none"
              strokeLinecap="round"
              pointerEvents="stroke"
              data-precise-hit={entry.id}
              onClick={() => onSelect(entry.id)}
              style={{ cursor: 'pointer' }}
            />
          ))}
      </g>
    </svg>
  );
}

/** Original, simple decorative glyphs for the symbol-only marks. */
export function PalmMarkGlyph({ regionId, size = 36, color = colors.traditional }: { regionId: string; size?: number; color?: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (regionId) {
    case 'palm-mark-yava': // barley grain
      body = (
        <>
          <ellipse cx={20} cy={20} rx={7} ry={15} {...common} transform="rotate(20 20 20)" />
          <path d="M 15 7 L 25 33" {...common} />
        </>
      );
      break;
    case 'palm-mark-matsya': // fish
      body = (
        <>
          <path d="M 5 20 C 12 9 26 9 31 20 C 26 31 12 31 5 20 Z" {...common} />
          <path d="M 31 20 L 37 13 L 37 27 Z" {...common} />
          <circle cx={11} cy={18} r={1.6} fill={color} />
        </>
      );
      break;
    case 'palm-mark-shankha': // conch
      body = (
        <>
          <path d="M 8 30 C 6 18 14 6 24 6 C 32 6 35 14 31 20 C 28 25 21 25 19 20 C 17 16 21 13 24 15" {...common} />
          <path d="M 8 30 L 28 30 C 32 30 34 27 31 20" {...common} />
        </>
      );
      break;
    case 'palm-mark-chatra': // parasol
      body = (
        <>
          <path d="M 4 20 C 8 8 32 8 36 20 Z" {...common} />
          <path d="M 20 20 L 20 35 C 20 38 16 38 16 35" {...common} />
          <path d="M 20 9 L 20 20 M 12 12 L 14 20 M 28 12 L 26 20" {...common} strokeWidth={1.4} />
        </>
      );
      break;
    case 'palm-mark-vedi': // waisted altar
      body = <path d="M 6 8 L 34 8 L 24 20 L 34 32 L 6 32 L 16 20 Z" {...common} />;
      break;
    default:
      body = <circle cx={20} cy={20} r={12} {...common} />;
  }
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
