'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  getPalmistryEntriesByCategory,
  getPalmistryEntry,
  PALMISTRY_ATTRIBUTION_LABELS,
  PALMISTRY_CONTENT_REVIEW,
  PALMISTRY_DIAGRAM_NOTE,
  PALMISTRY_ENTRIES,
  PALMISTRY_GENERAL_DISCLOSURE,
  PALMISTRY_HAND_CONVENTION_NOTE,
  PALMISTRY_INTRO,
  PALMISTRY_LONGEVITY_DISCLOSURE,
} from '../../../packages/palmistry/src/content';
import type { PalmistryCategory, PalmistryEntry, PalmistryEntryId } from '../../../packages/palmistry/src/content';
import { getPalmSource, PALM_SOURCES } from '../../../packages/palmistry/src/sources';
import { PalmHandDiagram, PalmMarkGlyph } from './PalmHandDiagram';
import { backButtonStyle, colors, radius, spacing, typography } from './theme';
import { EmptyState, PageHeader, SectionHeader, SegmentedControl, StatusBadge, SurfaceCard, TextButton } from './ui';

/**
 * AURA-PALM-01-I1 -- Explore -> Palmistry. An EDUCATIONAL guide only: static,
 * bundled content (packages/palmistry), no photo, camera, upload, AI call,
 * personal-data lookup, database access or network request of its own.
 * (page.tsx's existing per-tab effect records one PALMISTRY_GUIDE_OPENED
 * event with empty metadata, same as PANCHANG_CALENDAR_VIEWED. Individual
 * feature selections are deliberately NOT recorded: a per-user log of which
 * entries someone read would be a profile built from selections.)
 */

/** Launch gate (AURA-PALM-01-I1 review finding 1). Until a qualified human
 * reviewer approves the content (PALMISTRY_CONTENT_REVIEW in
 * packages/palmistry), a PRODUCTION build hides the Explore card and refuses
 * the 'palmistry' tab, so an accidental merge cannot publish unreviewed
 * content. Local/dev builds still show it for review. Not a flag framework:
 * one pure function over two existing values. */
export function isPalmistryAvailable(
  status: string = PALMISTRY_CONTENT_REVIEW.status,
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return status === 'APPROVED' || nodeEnv !== 'production';
}

type SelectionSource = 'list' | 'diagram' | 'mark';

export interface PalmistryViewProps {
  onBack: () => void;
  /** Optional deep-link/initial selection; invalid ids are handled safely. */
  initialEntryId?: string | null;
}

class DiagramBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p role="status" style={{ ...typography.body, textAlign: 'center', padding: spacing.lg }}>
          The illustration could not be displayed. Every feature is available in the list below.
        </p>
      );
    }
    return this.props.children;
  }
}

export function PalmistryView({ onBack, initialEntryId = null }: PalmistryViewProps) {
  const initialEntry = getPalmistryEntry(initialEntryId);
  const [selectedId, setSelectedId] = useState<string | null>(initialEntryId ?? null);
  const [category, setCategory] = useState<PalmistryCategory>(initialEntry?.category ?? 'line');

  const selectedEntry = getPalmistryEntry(selectedId);
  const invalidSelection = selectedId !== null && !selectedEntry;
  const lines = getPalmistryEntriesByCategory('line');
  const marks = getPalmistryEntriesByCategory('mark');

  const lastTrigger = useRef<{ id: PalmistryEntryId; source: SelectionSource } | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const select = useCallback((id: PalmistryEntryId, source: SelectionSource) => {
    const entry = getPalmistryEntry(id);
    if (!entry) {
      setSelectedId(id);
      return;
    }
    lastTrigger.current = { id: entry.id, source };
    setSelectedId(entry.id);
    setCategory(entry.category);
    // Review finding 10: on a single-column phone layout the detail panel can
    // be far above the "All features" list. A list selection moves focus to
    // the detail heading (which also scrolls it into view); diagram and mark
    // selections only scroll, so keyboard users can keep browsing lines.
    setTimeout(() => {
      const heading = detailRef.current?.querySelector<HTMLElement>('[data-detail-heading]');
      if (source === 'list') heading?.focus();
      else detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 0);
  }, []);

  const returnToOverview = useCallback(() => {
    const trigger = lastTrigger.current;
    setSelectedId(null);
    if (trigger && typeof document !== 'undefined') {
      // Review finding 14: return focus to the control that opened the entry.
      setTimeout(() => {
        const selector =
          trigger.source === 'diagram'
            ? `g[data-entry-id="${trigger.id}"]`
            : trigger.source === 'mark'
              ? `button[data-entry-id="${trigger.id}"]`
              : `[data-palm-list-entry="${trigger.id}"]`;
        document.querySelector<HTMLElement>(selector)?.focus();
      }, 0);
    }
  }, []);

  if (PALMISTRY_ENTRIES.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xl, fontFamily: 'sans-serif' }}>
        <BackButton onBack={onBack} />
        <PageHeader title="Palmistry" />
        <EmptyState title="Palmistry content is unavailable" description="Please check back later." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xl, paddingBottom: spacing.xxl, color: colors.textPrimary, fontFamily: 'sans-serif' }}>
      <BackButton onBack={onBack} />

      <PageHeader title="Palmistry" subtitle={PALMISTRY_INTRO.title} />

      <p style={{ ...typography.body, color: colors.textSecondary, margin: 0 }}>{PALMISTRY_INTRO.lead}</p>

      <SurfaceCard accentColor={colors.traditional} padding={spacing.md}>
        <div role="note" aria-label="About this guide" data-testid="palmistry-disclosure" style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-start' }}>
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.3 }}>ⓘ</span>
          <p style={{ ...typography.bodyStrong, fontSize: 13, margin: 0 }}>{PALMISTRY_GENERAL_DISCLOSURE}</p>
        </div>
      </SurfaceCard>

      {PALMISTRY_CONTENT_REVIEW.status !== 'APPROVED' && (
        <p data-testid="palmistry-review-notice" style={{ ...typography.caption, margin: 0 }}>
          {PALMISTRY_CONTENT_REVIEW.notice}
        </p>
      )}

      <SegmentedControl<PalmistryCategory>
        ariaLabel="Feature type"
        options={[
          { value: 'line', label: <>Lines ({lines.length})</> },
          { value: 'mark', label: <>Marks ({marks.length})</> },
        ]}
        value={category}
        onChange={setCategory}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: spacing.lg, alignItems: 'start' }}>
        <SurfaceCard>
          {category === 'line' ? (
            <figure style={{ margin: 0 }}>
              <DiagramBoundary>
                <PalmHandDiagram lines={lines} selectedId={selectedEntry?.category === 'line' ? selectedEntry.id : null} onSelect={(id) => select(id, 'diagram')} />
              </DiagramBoundary>
              <figcaption style={{ ...typography.caption, margin: `${spacing.sm}px 0 0` }}>{PALMISTRY_DIAGRAM_NOTE}</figcaption>
            </figure>
          ) : (
            <div>
              <div role="group" aria-label="Traditional marks" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: spacing.sm }}>
                {marks.map((entry) => (
                  <MarkButton key={entry.id} entry={entry} selected={selectedEntry?.id === entry.id} onSelect={(id) => select(id, 'mark')} />
                ))}
              </div>
              <p style={{ ...typography.caption, margin: `${spacing.md}px 0 0` }}>
                Marks are shown as symbols, not placed on a hand: the sources do not fix one position for each, and no palm is expected to carry them.
              </p>
            </div>
          )}
        </SurfaceCard>

        <section ref={detailRef} aria-label="Feature details" data-testid="palmistry-detail">
          {/* Review finding 9: announce a short status, not the whole entry. */}
          <p role="status" aria-live="polite" data-testid="palmistry-live-status" style={visuallyHidden}>
            {selectedEntry ? `Showing: ${selectedEntry.title}` : invalidSelection ? 'That feature is not available.' : ''}
          </p>
          {selectedEntry ? (
            <EntryDetail entry={selectedEntry} lineNumber={lines.findIndex((l) => l.id === selectedEntry.id) + 1} onOverview={returnToOverview} />
          ) : (
            <SurfaceCard>
              {invalidSelection ? (
                <div role="status" data-testid="palmistry-invalid-selection">
                  <p style={typography.bodyStrong}>That feature isn&apos;t available.</p>
                  <p style={{ ...typography.body, margin: `${spacing.xs}px 0 0` }}>Choose a line or mark from the list below.</p>
                  <div style={{ marginTop: spacing.sm }}>
                    <TextButton onClick={() => setSelectedId(null)} color={colors.info}>Back to overview</TextButton>
                  </div>
                </div>
              ) : (
                <div data-testid="palmistry-overview">
                  <SectionHeader label="Overview" color={colors.traditional} />
                  <p style={typography.body}>
                    Select a numbered line on the hand, a mark, or any entry in the list to read how the texts interpreted it and which sources describe it.
                  </p>
                </div>
              )}
            </SurfaceCard>
          )}
        </section>
      </div>

      <section aria-labelledby="palmistry-all-features">
        <h2 id="palmistry-all-features" style={{ ...typography.sectionEyebrow, margin: `0 0 ${spacing.md}px` }}>All features</h2>
        <EntryList heading="Lines" entries={lines} numbered selectedId={selectedEntry?.id ?? null} onSelect={(id) => select(id, 'list')} />
        <div style={{ height: spacing.md }} />
        <EntryList heading="Marks" entries={marks} selectedId={selectedEntry?.id ?? null} onSelect={(id) => select(id, 'list')} />
      </section>

      <SurfaceCard>
        <SectionHeader label="About this tradition" color={colors.traditional} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <p style={typography.body}>{PALMISTRY_INTRO.tradition}</p>
          <p style={typography.body}>{PALMISTRY_INTRO.linesAndMarks}</p>
          <div>
            <h3 style={{ ...typography.cardTitle, margin: `0 0 ${spacing.xs}px` }}>Indian and Western palmistry</h3>
            <p style={typography.body}>{PALMISTRY_INTRO.westernDifference}</p>
          </div>
          <div>
            <h3 style={{ ...typography.cardTitle, margin: `0 0 ${spacing.xs}px` }}>Which hand?</h3>
            <p style={typography.body}>{PALMISTRY_HAND_CONVENTION_NOTE}</p>
          </div>
          <p style={{ ...typography.body, color: colors.textSecondary }}>{PALMISTRY_INTRO.limits}</p>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader label="Sources" color={colors.traditional} />
        <ul style={{ margin: 0, paddingLeft: spacing.lg, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          {PALM_SOURCES.map((source) => (
            <li key={source.id} style={typography.meta}>
              <span style={{ color: colors.textSecondary, fontWeight: 700 }}>{source.title}</span>. {source.author}. {source.textDate}. {source.edition}.{' '}
              {source.url && (
                <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: colors.info }}>
                  Source link<span style={visuallyHidden}> (opens in a new tab)</span>
                </a>
              )}
              {source.licence && (
                <span data-testid={`palmistry-licence-${source.id}`}>
                  {' '}© {source.licence.copyrightHolder}, licensed under{' '}
                  <a href={source.licence.url} target="_blank" rel="noopener noreferrer license" style={{ color: colors.info }}>
                    {source.licence.name}
                    <span style={visuallyHidden}> (opens in a new tab)</span>
                  </a>
                  ; Aura&apos;s text paraphrases this work.
                </span>
              )}
            </li>
          ))}
        </ul>
        <p style={{ ...typography.caption, margin: `${spacing.md}px 0 0` }}>
          All descriptions are Aura&apos;s own paraphrases. No translations or diagrams are reproduced.
        </p>
      </SurfaceCard>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <button type="button" onClick={onBack} aria-label="Back to Explore" style={backButtonStyle}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
        Explore
      </button>
    </div>
  );
}

function MarkButton({ entry, selected, onSelect }: { entry: PalmistryEntry; selected: boolean; onSelect: (id: PalmistryEntryId) => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-entry-id={entry.id}
      onClick={() => onSelect(entry.id)}
      style={{
        minHeight: 88,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: radius.md,
        border: `${selected ? 2 : 1}px solid ${selected ? colors.traditional : colors.borderDefault}`,
        background: selected ? colors.traditionalSoft : 'rgba(2, 6, 23, 0.4)',
        color: colors.textPrimary,
        cursor: 'pointer',
        padding: spacing.sm,
      }}
    >
      <PalmMarkGlyph regionId={entry.diagramRegionId} />
      <span style={{ fontSize: 13, fontWeight: 800 }}>{entry.title}</span>
      {selected && <span style={{ ...typography.caption, color: colors.traditional }}>Selected</span>}
    </button>
  );
}

function EntryList({
  heading,
  entries,
  numbered = false,
  selectedId,
  onSelect,
}: {
  heading: string;
  entries: PalmistryEntry[];
  numbered?: boolean;
  selectedId: string | null;
  onSelect: (id: PalmistryEntryId) => void;
}) {
  return (
    <div>
      <h3 style={{ ...typography.cardTitle, margin: `0 0 ${spacing.sm}px` }}>{heading}</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        {entries.map((entry, index) => {
          const selected = entry.id === selectedId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={selected}
                data-palm-list-entry={entry.id}
                onClick={() => onSelect(entry.id)}
                style={{
                  width: '100%',
                  minHeight: 48,
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.sm,
                  textAlign: 'left',
                  borderRadius: radius.md,
                  border: `${selected ? 2 : 1}px solid ${selected ? colors.traditional : colors.borderSubtle}`,
                  background: selected ? colors.traditionalSoft : colors.surfaceSubtle,
                  color: colors.textPrimary,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  cursor: 'pointer',
                }}
              >
                {numbered && (
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, border: `1px solid ${colors.traditional}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                    {index + 1}
                  </span>
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 750 }}>{entry.title}</span>
                  {entry.traditionalName && (
                    <span lang="sa-Latn" style={{ ...typography.meta, margin: '0 0 0 6px', fontStyle: 'italic' }}>
                      {entry.traditionalName}
                    </span>
                  )}
                </span>
                {selected && <span style={{ ...typography.caption, margin: '0 0 0 auto', color: colors.traditional }}>Selected</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntryDetail({ entry, lineNumber, onOverview }: { entry: PalmistryEntry; lineNumber: number; onOverview: () => void }) {
  return (
    <SurfaceCard elevated accentColor={colors.traditional}>
      <article data-testid="palmistry-entry-detail" data-entry-id={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <header>
          <h2 data-detail-heading tabIndex={-1} style={typography.sectionTitle}>{entry.title}</h2>
          {entry.traditionalName && (
            <p lang="sa-Latn" style={{ ...typography.meta, fontStyle: 'italic', margin: '2px 0 0' }}>
              {entry.traditionalName}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
            <StatusBadge label={entry.tradition} tone="traditional" />
            <StatusBadge label={PALMISTRY_ATTRIBUTION_LABELS[entry.attributionStatus]} tone="neutral" />
            <StatusBadge label={`Attribution confidence: ${entry.attributionConfidence}`} tone="neutral" />
          </div>
        </header>

        <DetailBlock label="Where">
          <p style={typography.body}>{entry.description}</p>
          <p style={{ ...typography.caption, margin: '4px 0 0' }}>
            {entry.diagramPlacement === 'described-in-sources' && lineNumber > 0
              ? `Shown as line ${lineNumber} on the schematic drawing (approximate).`
              : 'Shown as a symbol only. Its position is not drawn on the hand.'}
          </p>
        </DetailBlock>

        <DetailBlock label="In this tradition">
          <p style={{ ...typography.body, color: colors.textSecondary }}>{entry.interpretation}</p>
        </DetailBlock>

        {entry.id === 'ayurlekha' && (
          <div role="note" data-testid="palmistry-longevity-disclosure" style={{ borderLeft: `3px solid ${colors.caution}`, paddingLeft: spacing.sm }}>
            <p style={{ ...typography.bodyStrong, fontSize: 13 }}>{PALMISTRY_LONGEVITY_DISCLOSURE}</p>
          </div>
        )}

        <DetailBlock label="Context and uncertainty">
          <p style={typography.body}>{entry.contextNote}</p>
        </DetailBlock>

        {entry.westernComparison && (
          <DetailBlock label="Western palmistry, for comparison">
            <p style={typography.body}>{entry.westernComparison}</p>
          </DetailBlock>
        )}

        <DetailBlock label="Sources">
          <ul style={{ margin: 0, paddingLeft: spacing.lg, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entry.sources.map((ref) => {
              const source = getPalmSource(ref.sourceId);
              return (
                <li key={`${ref.sourceId}-${ref.locator}`} style={typography.meta}>
                  {source ? (
                    <>
                      {source.shortCitation}, {ref.locator}
                    </>
                  ) : (
                    <>Source details unavailable ({ref.locator})</>
                  )}
                </li>
              );
            })}
          </ul>
        </DetailBlock>

        <div>
          <TextButton onClick={onOverview} color={colors.info}>
            ← Back to overview
          </TextButton>
        </div>
      </article>
    </SurfaceCard>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ ...typography.sectionEyebrow, color: colors.traditional, margin: '0 0 4px' }}>{label}</h3>
      {children}
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
