import React from 'react';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, TextButton } from './ui';
import { keepSummary, presentMove, unresolvedText, type RecompositionUnresolvedRow, type RecompositionState, type RecompositionView } from '../lib/homeRecomposition';

/**
 * Remaining-Day Recomposition V1 PR F4 -- the inline proposal card. PRESENTATIONAL ONLY: it fetches nothing, holds no
 * state, computes no scheduling and cannot change a proposal -- it renders the state it is given and calls back.
 * The times it shows exist only here; the actual Timeline keeps committed truth until the server confirms acceptance.
 */
export interface RecompositionCardProps {
  state: RecompositionState;
  timezone: string;
  /** A conflicting plan mutation is running: Accept waits (the card itself stays readable). */
  acceptBlocked?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  /** "Try again" / "Check again": a fresh proposal request. */
  onRetry: () => void;
}

const visuallyHidden: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
const headingStyle: React.CSSProperties = { ...typography.cardTitle, outline: 'none' };
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm };
const tap: React.CSSProperties = { minHeight: 44 };

/** kind-only heading/labels: no internal vocabulary (tiers, decisions, scheduling modes) ever reaches the user. */
const HEADING_ID = 'home-recomposition-heading';

export function RecompositionCard({ state, timezone, acceptBlocked = false, onAccept, onDismiss, onRetry }: RecompositionCardProps) {
  if (state.phase === 'IDLE' && !state.updated) return null;

  const accepting = state.phase === 'ACCEPTING';
  const view: RecompositionView | null = state.phase === 'PROPOSAL' || state.phase === 'ACCEPTING' ? state.view : null;
  const heading = view?.kind === 'CHANGES_PROPOSED' ? 'Suggested changes — not applied yet' : 'Reviewing the rest of your day';

  const closeButton = (label: string) => (
    <TextButton onClick={onDismiss} disabled={accepting} style={{ ...tap, padding: '0 8px' }} color={colors.textSecondary}>
      {label}
    </TextButton>
  );
  const retryButton = (label: string) => (
    <SecondaryButton onClick={onRetry} style={{ ...tap, padding: '0 16px' }}>
      {label}
    </SecondaryButton>
  );

  let body: React.ReactNode;
  if (state.phase === 'IDLE') {
    // Success surface: focus lands here after a batch acceptance (never on an individual successor).
    body = (
      <>
        <p role="status" data-recomposition-status tabIndex={-1} style={{ ...typography.bodyStrong, outline: 'none' }}>
          Your day is updated.
        </p>
        <div style={actionsStyle}>{closeButton('Close')}</div>
      </>
    );
  } else if (state.phase === 'LOADING') {
    body = (
      <p role="status" style={typography.body}>
        Looking at your day…
      </p>
    );
  } else if (state.phase === 'STALE') {
    body = (
      <>
        <p role="alert" style={{ ...typography.bodyStrong, color: colors.caution }}>
          Your day changed while you were reviewing.
        </p>
        <div style={actionsStyle}>
          {retryButton('Check again')}
          {closeButton('Close')}
        </div>
      </>
    );
  } else if (state.phase === 'ERROR') {
    const message =
      state.error === 'INVALID_TOKEN'
        ? 'This suggestion is no longer valid.'
        : state.error === 'TIMING_FAILED'
          ? "Couldn't check your day right now. Nothing was changed."
          : "Couldn't review your day right now. Nothing was changed.";
    body = (
      <>
        <p role="alert" style={{ ...typography.bodyStrong, color: colors.danger }}>
          {message}
        </p>
        <div style={actionsStyle}>
          {retryButton(state.error === 'INVALID_TOKEN' ? 'Check again' : 'Try again')}
          {closeButton('Close')}
        </div>
      </>
    );
  } else if (view) {
    body = renderView(view, state, { timezone, acceptBlocked, accepting, onAccept, closeButton });
  }

  return (
    <section role="region" aria-labelledby={HEADING_ID} aria-busy={state.phase === 'LOADING' || accepting || undefined} data-recomposition-card style={{ marginBottom: spacing.md }}>
      <SurfaceCard accentColor={colors.caution} style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <h3 id={HEADING_ID} tabIndex={-1} data-recomposition-heading style={headingStyle}>
          {state.phase === 'IDLE' ? 'Your day' : heading}
        </h3>
        {body}
      </SurfaceCard>
    </section>
  );
}

function renderView(
  view: RecompositionView,
  state: Extract<RecompositionState, { phase: 'PROPOSAL' | 'ACCEPTING' }>,
  ctx: { timezone: string; acceptBlocked: boolean; accepting: boolean; onAccept: () => void; closeButton: (label: string) => React.ReactNode }
): React.ReactNode {
  const unresolvedList = (rows: RecompositionUnresolvedRow[]) =>
    rows.length === 0 ? null : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        <h4 style={{ ...typography.sectionEyebrow, color: colors.caution }}>Needs your attention</h4>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
          {rows.map((row) => (
            <li key={row.planId} style={typography.body}>
              {unresolvedText(row, ctx.timezone)}
            </li>
          ))}
        </ul>
      </div>
    );
  const keep = 'keepCount' in view ? keepSummary(view.keepCount) : null;

  if (view.kind === 'NO_USABLE_CAPACITY') {
    return (
      <>
        <p role="status" style={typography.bodyStrong}>
          There isn&apos;t any usable time left today to rearrange.
        </p>
        <div style={actionsStyle}>{ctx.closeButton('Close')}</div>
      </>
    );
  }
  if (view.kind === 'NO_CHANGES') {
    return (
      <>
        <p role="status" style={typography.bodyStrong}>
          Your day already works. Nothing to move.
        </p>
        <div style={actionsStyle}>{ctx.closeButton('Done')}</div>
      </>
    );
  }
  if (view.kind === 'NEEDS_ATTENTION') {
    return (
      <>
        <p style={typography.bodyStrong}>A few things need your decision first.</p>
        {unresolvedList(view.unresolved)}
        {keep && <p style={typography.meta}>{keep}</p>}
        <div style={actionsStyle}>{ctx.closeButton('Close')}</div>
      </>
    );
  }

  // CHANGES_PROPOSED: the only state that can be accepted.
  const notice = state.phase === 'PROPOSAL' ? state.notice : null;
  return (
    <>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {view.moves.map((move) => {
          const row = presentMove(move, ctx.timezone);
          return (
            <li key={row.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.sm }}>
              <span style={typography.bodyStrong}>{row.title}</span>
              <span style={visuallyHidden}>{`, from ${row.from} to ${row.to}`}</span>
              <span aria-hidden="true" style={typography.meta}>
                {row.from} → {row.to}
              </span>
            </li>
          );
        })}
      </ul>
      {keep && <p style={typography.meta}>{keep}</p>}
      {unresolvedList(view.unresolved)}
      {ctx.accepting ? (
        <p role="status" style={typography.body}>
          {state.phase === 'ACCEPTING' && state.reconciling ? 'Checking your day…' : 'Saving your new arrangement…'}
        </p>
      ) : notice === 'SAVE_FAILED' ? (
        <p role="alert" style={{ ...typography.bodyStrong, color: colors.danger }}>
          Couldn&apos;t save. Nothing was changed. Try again.
        </p>
      ) : notice === 'UNCONFIRMED' ? (
        <p role="alert" style={{ ...typography.bodyStrong, color: colors.caution }}>
          We couldn&apos;t confirm whether your day was updated. Check your day, then try again if needed.
        </p>
      ) : null}
      <div style={actionsStyle}>
        <PrimaryButton onClick={ctx.onAccept} disabled={ctx.accepting || ctx.acceptBlocked} style={{ ...tap, padding: '0 20px', flex: '1 1 220px' }}>
          Accept new arrangement
        </PrimaryButton>
        {ctx.closeButton('Not now')}
      </div>
    </>
  );
}
