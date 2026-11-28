'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PALM_SCOPE_NOTE } from '../../lib/palm-analysis/analyze';
import { isPalmImageInputEnabled } from '../../lib/palm-analysis/gate';
import { createMediaPipeHandDetector } from '../../lib/palm-analysis/mediapipeDetector';
import { createPalmAnalysisSession, type PalmAnalysisSession, type PalmSessionDeps, type PalmSessionState } from '../../lib/palm-analysis/session';
import {
  clientToImage,
  containRect,
  createTracingModel,
  resampleStroke,
  spaceStroke,
  MAX_TRACE_INPUT_POINTS,
  TRACE_POINT_LIMITS,
  TracingError,
  TRACING_LINE_NAMES,
  TRACING_LINES,
  type PalmConstructionContext,
  type TracingLineId as PalmLineId,
  type TracingLineView,
  type TracingModel,
  type TracingPoint,
  type TracingUnassessedReason as LineUnassessedReason,
} from '../../lib/palm-analysis';
import { PALM_UPLOAD_ACCEPT } from '../../lib/palm-analysis/validate';
import { colors, radius, spacing, typography } from '../theme';
import { SectionHeader, StatusBadge, SurfaceCard } from '../ui';

/**
 * AURA-PALM-G5-I1 -- "Upload Photo": the first palm-image input inside the
 * Palmistry screen. DEVELOPMENT ONLY (see lib/palm-analysis/gate.ts).
 *
 * Acquisition only: this component picks a file and shows state. Every
 * processing step lives in the shared lib/palm-analysis pipeline, which the
 * G5-I2 camera adapter will reuse unchanged. There is deliberately NO camera
 * button and the file input has NO `capture` attribute.
 */

export { isPalmImageInputEnabled };

export const PALM_PRIVACY_NOTE = 'Development preview. Your photo is checked on this device. It is not uploaded or saved, and it is cleared when you leave Palmistry.';
export const PALM_UPLOAD_HINT = 'Use a well-lit photo of one open palm, fingers pointing up. JPEG, PNG or WebP, up to 15 MB.';

export interface PalmImageInputProps {
  /** Test seam: replace the detector / decoder / canvas factory. */
  sessionDeps?: Partial<PalmSessionDeps>;
}

export function PalmImageInput(props: PalmImageInputProps) {
  // Gate first: in any non-development or non-opted-in environment nothing
  // renders and no session (or model) is ever created.
  if (!isPalmImageInputEnabled()) return null;
  return <PalmImageInputEnabled {...props} />;
}

const STATUS_TEXT: Record<PalmSessionState['phase'], string> = {
  idle: '',
  validating: 'Checking the file…',
  'loading-model': 'Loading the on-device hand model…',
  analysing: 'Checking hand position and image quality…',
  result: '',
  error: '',
};

function PalmImageInputEnabled({ sessionDeps }: PalmImageInputProps) {
  const ids = useId();
  const hintId = `${ids}-hint`;
  const privacyId = `${ids}-privacy`;
  const headingId = `${ids}-heading`;
  const sessionRef = useRef<PalmAnalysisSession | null>(null);
  const [state, setState] = useState<PalmSessionState | null>(null);
  // AURA-PALM-04-I2: the analysed photo's in-memory construction context (P4-I1) and whether tracing is open.
  const [construction, setConstruction] = useState<PalmConstructionContext | null>(null);
  const [tracing, setTracing] = useState(false);
  const traceButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const lastPhase = useRef<PalmSessionState['phase']>('idle');

  // One session per mount. Created in an effect so React StrictMode's
  // mount/unmount/mount cycle disposes the first one cleanly.
  useEffect(() => {
    const session = createPalmAnalysisSession({ detectorFactory: () => createMediaPipeHandDetector(), ...sessionDeps });
    sessionRef.current = session;
    setState(session.getState());
    const unsubscribe = session.subscribe((s) => {
      setState(s);
      setConstruction(session.getConstructionContext());
    });
    // Leaving the page (tab close, navigation, bfcache) clears the image.
    const onPageHide = () => session.clear();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
      session.dispose(); // releases the frame, revokes the construction context and closes the model
      sessionRef.current = null;
      if (previewRef.current) previewRef.current.replaceChildren();
    };
    // sessionDeps is a test seam and intentionally read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frame = state?.frame ?? null;
  const phase = state?.phase ?? 'idle';

  // A new photo, a cleared photo or a revoked context closes tracing: traces never carry over to another photo.
  useEffect(() => { setTracing(false); }, [construction]);
  const canTrace = phase === 'result' && !!frame && !frame.released && !!construction && construction.isActive();
  const showTracing = tracing && canTrace;

  // Show the pipeline-owned, EXIF-free canvas as the preview. No object URL
  // of the original file is ever created for display.
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    if (!frame || frame.released) {
      host.replaceChildren();
      return;
    }
    const canvas = frame.canvas as unknown as HTMLCanvasElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Preview of the selected photo');
    canvas.setAttribute('data-testid', 'palm-preview-canvas');
    Object.assign(canvas.style, { display: 'block', width: '100%', height: 'auto', borderRadius: `${radius.md}px` });
    host.replaceChildren(canvas);
  }, [frame]);

  // Move focus to the outcome once, when a result or error arrives.
  useEffect(() => {
    if ((phase === 'result' || phase === 'error') && lastPhase.current !== phase) resultHeadingRef.current?.focus();
    lastPhase.current = phase;
  }, [phase, state?.generation]);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again; drops the input's reference
    if (file) void sessionRef.current?.submitFile(file);
  }, []);

  const remove = useCallback(() => {
    sessionRef.current?.clear();
    setTimeout(() => uploadButtonRef.current?.focus(), 0);
  }, []);

  const retry = useCallback(() => void sessionRef.current?.retry(), []);

  const busy = phase === 'validating' || phase === 'loading-model' || phase === 'analysing';
  const hasImage = Boolean(frame && !frame.released);
  const result = state?.result ?? null;
  const error = state?.error ?? null;
  const aspect = frame && frame.height > 0 ? frame.width / frame.height : 1;
  const statusText = busy ? STATUS_TEXT[phase] : phase === 'result' && result ? result.headline : phase === 'error' && error ? error.message : '';

  return (
    <SurfaceCard accentColor={colors.traditional} padding={spacing.md}>
      <section aria-labelledby={headingId} data-testid="palm-image-input" style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <h2 id={headingId} style={{ ...typography.cardTitle, margin: 0 }}>Check a palm photo</h2>
          <StatusBadge label="Development preview" tone="caution" />
        </div>

        {!showTracing && <ScannerSteps current={1} />}
        <p id={hintId} style={{ ...typography.body, margin: 0 }}>{PALM_UPLOAD_HINT}</p>
        <p id={privacyId} data-testid="palm-privacy-note" style={{ ...typography.caption, margin: 0 }}>
          <span aria-hidden="true">🔒 </span>
          {PALM_PRIVACY_NOTE}
        </p>

        {/* Hidden native picker; the labelled button below opens it. No `capture` attribute. */}
        <input
          ref={inputRef}
          type="file"
          accept={PALM_UPLOAD_ACCEPT}
          onChange={onFileChange}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="palm-file-input"
          style={visuallyHidden}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
          <button
            ref={uploadButtonRef}
            type="button"
            onClick={openPicker}
            aria-describedby={`${hintId} ${privacyId}`}
            data-testid="palm-upload-button"
            style={hasImage || phase === 'error' ? secondaryButtonStyle : primaryButtonStyle}
          >
            {hasImage || phase === 'error' ? 'Choose another photo' : 'Upload photo'}
          </button>
          {(hasImage || phase === 'error') && (
            <button type="button" onClick={remove} data-testid="palm-remove-button" style={secondaryButtonStyle}>
              Remove photo
            </button>
          )}
          {phase === 'error' && error?.retryable && hasImage && (
            <button type="button" onClick={retry} data-testid="palm-retry-button" style={secondaryButtonStyle}>
              Try again
            </button>
          )}
        </div>

        {/* Single polite live region for every state change. */}
        <p role="status" aria-live="polite" data-testid="palm-status" style={busy ? { ...typography.body, margin: 0, color: colors.textSecondary } : visuallyHidden}>
          {statusText}
        </p>

        <div
          data-testid="palm-preview"
          aria-busy={busy || undefined}
          hidden={showTracing || undefined}
          style={{ position: 'relative', width: '100%', maxWidth: hasImage ? `min(100%, ${Math.round(360 * aspect)}px)` : undefined, alignSelf: 'center', opacity: busy ? 0.7 : 1, display: showTracing ? 'none' : undefined }}
        >
          <div ref={previewRef} />
          {hasImage && phase === 'result' && result?.palmBox && (
            <div
              aria-hidden="true"
              data-testid="palm-box-outline"
              style={{
                position: 'absolute',
                left: `${result.palmBox.x0 * 100}%`,
                top: `${result.palmBox.y0 * 100}%`,
                width: `${(result.palmBox.x1 - result.palmBox.x0) * 100}%`,
                height: `${(result.palmBox.y1 - result.palmBox.y0) * 100}%`,
                border: `2px dashed ${result.status === 'accepted' ? colors.positive : colors.caution}`,
                borderRadius: radius.sm,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>

        {phase === 'result' && result && (
          <div data-testid="palm-result" data-status={result.status} style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            <SectionHeader label="Photo check" color={colors.traditional} />
            <h3 ref={resultHeadingRef} tabIndex={-1} data-testid="palm-result-heading" style={{ ...typography.bodyStrong, margin: 0, color: result.status === 'accepted' ? colors.positive : colors.textPrimary }}>
              {result.headline}
            </h3>
            {result.issues.length > 0 && (
              <ul data-testid="palm-issues" style={{ margin: 0, paddingLeft: spacing.lg, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.issues.map((issue) => (
                  <li key={issue.code} data-issue={issue.code} style={typography.body}>{issue.message}</li>
                ))}
              </ul>
            )}
            <p data-testid="palm-scope-note" style={{ ...typography.caption, margin: 0 }}>{PALM_SCOPE_NOTE}</p>
            {canTrace && !showTracing && (
              <button ref={traceButtonRef} type="button" onClick={() => setTracing(true)} data-testid="palm-trace-button" style={{ ...secondaryButtonStyle, alignSelf: 'flex-start' }}>
                Trace palm lines (development)
              </button>
            )}
            {result.metrics && (
              <details style={typography.caption}>
                <summary style={{ cursor: 'pointer', minHeight: 32 }}>Technical details (development)</summary>
                <p style={{ ...typography.caption, margin: `${spacing.xs}px 0 0` }}>
                  Brightness {result.metrics.brightness}, contrast {result.metrics.contrast}, sharpness {result.metrics.sharpness}, palm area {Math.round(result.metrics.palmFraction * 100)}% of the photo, rotation {result.metrics.rotationDeg}°, palm facing camera: {result.metrics.palmFacing ? 'yes' : 'no'}. Thresholds are provisional.
                </p>
              </details>
            )}
          </div>
        )}

        {showTracing && construction && frame && (
          <PalmTracingPanel
            key={construction.generation}
            context={construction}
            imageSource={frame.canvas as unknown as CanvasImageSource}
            onClose={() => { setTracing(false); setTimeout(() => traceButtonRef.current?.focus(), 0); }}
            onRestart={() => { setTracing(false); sessionRef.current?.clear(); setTimeout(() => uploadButtonRef.current?.focus(), 0); }}
          />
        )}

        {phase === 'error' && error && (
          <div role="alert" data-testid="palm-error" data-code={error.code} style={{ borderLeft: `3px solid ${colors.caution}`, paddingLeft: spacing.sm }}>
            <h3 ref={resultHeadingRef} tabIndex={-1} data-testid="palm-error-heading" style={{ ...typography.bodyStrong, margin: 0 }}>
              {error.message}
            </h3>
          </div>
        )}
      </section>
    </SurfaceCard>
  );
}

const buttonBase: React.CSSProperties = {
  minHeight: 48,
  minWidth: 48,
  padding: `0 ${spacing.lg}px`,
  borderRadius: radius.md,
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  border: 'none',
  background: colors.traditional,
  color: '#0b1020',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  border: `1px solid ${colors.borderDefault}`,
  background: colors.surfaceSubtle,
  color: colors.textPrimary,
};

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

// ================================================================ AURA-PALM-04-I2 tracing overlay

/**
 * AURA-PALM-04-I2 -- the interactive tracing overlay. DEVELOPMENT ONLY: it lives in this file and is rendered only by
 * PalmImageInput (behind the G5 image-input gate). Every production build replaces this whole file with an empty
 * stand-in, so the overlay and lib/palm-analysis are never bundled for release.
 *
 * The user traces one line at a time on their own analysed photo. Everything here is a view over the P4-I1 headless
 * tracing model: the model owns the line states, undo and the placement verdict, and that verdict is the frozen I1
 * builder's own (nothing in this file judges a trace). The overlay only
 *   - shows the photo, the finger-base and wrist guides and the traces in ONE image geometry (lib/palm-analysis/
 *     tracingGeometry.ts, object-fit: contain), and maps pointer positions back through the same geometry;
 *   - turns a pointer gesture into points for the model: a tap adds one point, a drag replaces the line's trace with
 *     the drawn stroke (spaced and resampled so I1's point limit is respected);
 *   - discards interrupted gestures (pointercancel, lost capture) without changing anything, and refuses gestures
 *     that began on a model whose photo was since replaced or cleared.
 * Placement feedback describes the trace's geometric suitability only. Aura does not detect palm lines.
 *
 * Privacy: the photo, landmarks and traces exist only in this component's memory and the session's construction
 * context. Nothing is stored, logged or sent. Unmounting (cancel, photo removal or replacement, leaving the screen)
 * drops every trace and clears the overlay's own copy of the photo.
 */

export const PALM_TRACING_UI_VERSION = 'palm-04-tracing-ui@0.1.0';
/** At most this many points are handed to the model for one drawn stroke (I1 allows TRACE_POINT_LIMITS.max). */
export const TRACING_STROKE_MAX_POINTS = Math.min(24, TRACE_POINT_LIMITS.max);
/** A gesture that moves less than this (CSS px) is a tap. */
export const TRACING_TAP_SLOP_PX = 6;

export const TRACING_SCOPE_NOTE = 'Aura does not find palm lines for you. It only checks that the shape and position of your trace can be used.';
export const TRACING_INPUT_NOTE = 'Draw with a finger, stylus or mouse: tap to add points, or drag to draw the whole line. Drawing needs a pointer; if you cannot draw a line, choose Skip or I can’t see this line.';

const LINE_COPY: Record<PalmLineId, { readonly title: string; readonly instruction: string; readonly optional: boolean }> = {
  heart: { title: 'Heart line', instruction: 'Trace the upper line that runs across the palm, just below the fingers.', optional: false },
  head: { title: 'Head line', instruction: 'Trace the line across the middle of the palm, below the heart line.', optional: false },
  life: { title: 'Life line', instruction: 'Trace the curved line that runs around the base of the thumb.', optional: false },
  upward: { title: 'Upward line (optional)', instruction: 'If you can see one, trace the line that runs up the centre of the palm towards the middle finger. If you leave it, it is recorded as not requested.', optional: true },
};

/** I1's reason, described as what the user can change about the trace's shape or position. */
export const PLACEMENT_TEXT: Partial<Record<LineUnassessedReason, string>> = {
  'trace-too-few-points': `Add at least ${TRACE_POINT_LIMITS.min} points along the line.`,
  'trace-too-many-points': 'This trace has too many points. Clear it and draw it again.',
  'trace-point-invalid': 'Some points could not be read. Clear the line and trace it again.',
  'trace-outside-image': 'Part of the trace is outside the photo. Keep it on the photo.',
  'trace-outside-palm-frame': 'Part of the trace is too far from the palm. Keep it on the palm.',
  'trace-too-few-distinct-points': 'The points are too close together. Spread them along the line.',
  'trace-repeated-point': 'The trace repeats a point. Clear it and trace it again.',
  'trace-too-short': 'The trace is too short. Follow the line further across the palm.',
  'trace-doubles-back': 'The trace turns back sharply. Draw it in one direction.',
  'trace-self-intersecting': 'The trace crosses itself. Draw it in one direction without crossing.',
  'trace-tortuous': 'The trace winds too much. Follow the line more directly.',
  'frame-unavailable': 'The palm area could not be measured on this photo, so traces cannot be checked. You can skip lines or mark them as not visible.',
};
/** Shown when the model's input cap (MAX_TRACE_INPUT_POINTS) refuses another point; nothing is added or truncated. */
export const POINT_LIMIT_TEXT = `This line has reached the point limit (${MAX_TRACE_INPUT_POINTS} points), so nothing was added. Use Undo, Clear line, or retrace the line with one drag.`;
/** R3: any gesture (tap or drag) whose pointer left the photo at any delivered sample is refused; nothing changes. */
export const GESTURE_OFF_PHOTO_TEXT = 'The pointer went outside the photo, so nothing was changed. Keep the whole trace on the photo.';
/** R4: a gesture with any sample that could not be mapped to the photo (geometry unavailable, non-finite) is refused. */
/**
 * AURA-PALM-04-I3 -- feature review and confirmation (plan step 4, G-4/G-5). DEVELOPMENT ONLY, in this file so the
 * production stub removes it with the rest. The review shows I1's own feature set (model.buildFeatureSet) for the
 * user's explicit hand answers; nothing is read, stored or sent. A confirmation is bound to the photo (context
 * generation), the exact line states and the hand answers, and is withdrawn by any later change.
 */
export const PALM_FEATURE_REVIEW_VERSION = 'palm-04-feature-review@0.1.0';
export const REVIEW_SCOPE_NOTE = 'Confirming records these features for this photo only, in this browser tab. Nothing is stored or sent, and no reading is produced in this version.';
export const REVIEW_PRIMARY_LINES: readonly PalmLineId[] = ['heart', 'head', 'life'];
type ReviewHand = 'left' | 'right';
type ReviewDominant = 'left' | 'right' | 'unknown';
type FeatureSetResult = ReturnType<TracingModel['buildFeatureSet']>;
type ConfirmedFeatures = { readonly key: string; readonly featureSet: unknown; readonly at: number };
/** What a review is about: the photo, the exact line states and the hand answers. Any change makes a new key. */
export const lineSignature = (views: readonly TracingLineView[]): string => JSON.stringify(views.map((v) => [v.line, v.status, v.skipReason, v.points]));
const MEASUREMENT_LABELS: Record<string, string> = {
  palmLength: 'Palm length', thumbLength: 'Thumb length', indexLength: 'Index finger length', middleLength: 'Middle finger length',
  ringLength: 'Ring finger length', littleLength: 'Little finger length', handLength: 'Hand length',
  middleToPalmRatio: 'Middle finger to palm ratio', indexToRingRatio: 'Index to ring finger ratio',
};
/** Everything that must be decided before features can be confirmed. Empty when ready. Nothing is ever defaulted. */
export function reviewBlockers(views: readonly TracingLineView[], hand: ReviewHand | null, dominant: ReviewDominant | null, result: FeatureSetResult | null, uncertain: boolean, acknowledged: boolean): string[] {
  const out: string[] = [];
  if (!hand) out.push('Choose which hand is in the photo.');
  if (!dominant) out.push('Choose your dominant hand, or Not sure.');
  for (const v of views) {
    const title = LINE_COPY[v.line].title;
    if (v.status === 'tracing') out.push(`${title}: the trace is an unconfirmed draft. Confirm it, skip it or clear it.`);
    else if (v.status === 'not-started' && REVIEW_PRIMARY_LINES.includes(v.line)) out.push(`${title}: not traced yet. Trace it, or choose Skip or I can’t see this line.`);
  }
  if (hand && dominant && result && !result.ok) out.push('The features could not be put together from these traces. Go back and check the lines.');
  if (uncertain && !acknowledged) out.push('Tick the box to confirm that you have seen the uncertain items.');
  return out;
}
/** True when the assembled features contain anything uncertain or unavailable (it stays marked so; confirming never upgrades it). */
export function hasUncertainty(result: FeatureSetResult | null): boolean {
  if (!result || !result.ok) return false;
  const fs = result.featureSet;
  return !fs.frame.available || fs.frame.qualityStatus !== 'accepted' || fs.measurements.status !== 'measured';
}
/** One-line summary of a confirmed feature set's lines (line:provenance/reason), for display and audit. */
export const confirmedLineSummary = (featureSet: unknown): string => {
  const lines = (featureSet as { lines?: Record<string, { provenance: string; reason?: string }> })?.lines ?? {};
  return TRACING_LINES.map((id) => { const l = lines[id]; return l ? `${id}:${l.provenance}${l.reason ? `/${l.reason}` : ''}` : `${id}:missing`; }).join(';');
};
/**
 * AURA-PALM-04-I4 -- friendly wording for I1's uncertainty and quality codes. Display only: the codes themselves (and
 * the confirmed record) are unchanged, and each shown reason keeps its code in `data-code`.
 */
export const UNCERTAINTY_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'input-invalid': 'The hand data could not be read.',
  'landmarks-invalid': 'The hand points could not be read.',
  'landmark-out-of-frame': 'Part of the hand is outside the photo.',
  'quality-invalid': 'The photo check could not be read.',
  'quality-unknown': 'The photo check was not available.',
  'computation-nonfinite': 'This could not be calculated.',
  'image-size-invalid': 'The photo size could not be read.',
  'frame-degenerate': 'The palm shape could not be measured.',
  'palm-not-facing': 'The palm does not seem to face the camera.',
  'palm-facing-unknown': 'It is unclear whether the palm faces the camera.',
  'palm-not-visible': 'The palm is not clearly visible.',
  'hand-cut-off': 'Part of the hand is cut off.',
  'hand-too-small': 'The hand is small in the photo.',
  'hand-rotated': 'The hand is tilted.',
  'too-dark': 'The photo is too dark.',
  'too-bright': 'The photo is too bright.',
  'low-contrast': 'The photo has low contrast.',
  'blurry': 'The photo looks blurry.',
  'implausible-proportions': 'The proportions look unusual for a hand, so they may not be accurate.',
  'finger-not-extended': 'A finger is bent, so its length cannot be measured.',
  'depends-on-unavailable': 'It depends on a measurement that is not available.',
  'depends-on-uncertain': 'It depends on a measurement that is uncertain.',
});
export const friendlyReason = (code: string): string => UNCERTAINTY_TEXT[code] ?? 'This could not be checked.';
const STATUS_TEXT_FRIENDLY: Record<string, string> = { measured: 'Measured', uncertain: '⚠ Uncertain', unavailable: '⚠ Not available' };
/** Reasons as friendly sentences, each keeping its I1 code. */
function ReasonList({ codes, testid }: { codes: readonly string[]; testid?: string }) {
  if (!codes.length) return null;
  return (
    <ul data-testid={testid} style={{ margin: '2px 0 0', paddingLeft: spacing.lg }}>
      {codes.map((c) => <li key={c} data-code={c} style={typography.caption}>{friendlyReason(c)}</li>)}
    </ul>
  );
}

/** AURA-PALM-04-I4 -- the scanner journey's progress: photo, trace, review, result. */
export const SCANNER_STEPS = ['Photo', 'Trace lines', 'Review', 'Result'] as const;
export function ScannerSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol aria-label="Scanner progress" data-testid="palm-scanner-steps" data-current={current} style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs, listStyle: 'none', padding: 0, margin: 0 }}>
      {SCANNER_STEPS.map((label, k) => {
        const n = k + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li key={label} data-step={n} data-state={state} aria-current={n === current ? 'step' : undefined} style={{ ...typography.caption, padding: '4px 8px', borderRadius: radius.sm, border: `1px solid ${n === current ? colors.traditional : colors.borderSubtle}`, background: n === current ? colors.traditionalSoft : 'transparent', fontWeight: n === current ? 800 : 500 }}>
            {state === 'done' ? '✓ ' : `${n}. `}{label}
          </li>
        );
      })}
    </ol>
  );
}

const deepFreeze = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); } return o; };

export const GESTURE_UNVERIFIABLE_TEXT = 'The photo position could not be checked during this gesture, so nothing was changed. Please trace again.';
export const PLACEMENT_OK_TEXT = 'The shape and position of this trace can be used. Confirm it if it follows the line you see.';
const placementText = (r: LineUnassessedReason) => PLACEMENT_TEXT[r] ?? 'This trace cannot be used yet.';

export function lineStatusText(v: TracingLineView): string {
  if (v.status === 'confirmed') return 'Confirmed';
  if (v.status === 'skipped') return v.skipReason === 'user-cannot-see' ? 'Can’t see (not assessed)' : 'Skipped (not assessed)';
  if (v.status === 'tracing') return v.points.length === 0 ? 'Started' : v.placement?.ok ? 'Draft, ready to confirm' : 'Draft, needs changes';
  return LINE_COPY[v.line].optional ? 'Not traced (not requested)' : 'Not started';
}

export interface PalmTracingPanelProps {
  /** The analysed photo's construction context (P4-I1). */
  context: PalmConstructionContext;
  /** The analysed photo (the session's EXIF-free frame canvas, or a synthetic fixture), at the context's image size. */
  imageSource: CanvasImageSource;
  /** Close tracing (cancellation): the panel unmounts and every trace is dropped. */
  onClose?: () => void;
  /** Start over (P4-I4): the owner clears the photo, which revokes the context and drops every trace and answer. */
  onRestart?: () => void;
}

/**
 * A pointer gesture in progress. Its `epoch` is the panel's gesture epoch when it began. GESTURE CONTRACT (R1):
 *   - a gesture can only ever complete into the model, line and epoch it started on;
 *   - every explicit decision (Confirm, Edit, Trace this line, Skip, I can't see this line, Clear line, Undo, Back,
 *     Next, a step button), a new context (photo replacement), revocation and teardown invalidate it first: the epoch
 *     moves on, the draft is dropped and pointer capture is released, so a later release changes nothing;
 *   - the release position is part of the stroke (it is mapped through the same geometry and judged by I1);
 *   - R3: EVERY delivered sample -- each coalesced pointermove sample, every move and the release -- is checked against
 *     the photo with the shared geometry BEFORE any spacing or simplification. A gesture (tap or drag) that left the
 *     photo at any sample is refused and changes nothing; coming back inside does not restore it (never clamped, never
 *     shortened into an eligible trace);
 *   - R4: validation FAILS CLOSED -- a sample that cannot be mapped and verified (photo geometry unavailable, e.g. a
 *     zero-size stage, or a non-finite position) invalidates the whole gesture exactly like an outside sample; restoring
 *     the geometry or returning inside never restores it;
 *   - pointercancel or lost capture discard it.
 */
type Gesture = { id: number; epoch: number; model: TracingModel; line: PalmLineId; pts: TracingPoint[]; startClient: { x: number; y: number }; moved: boolean; invalid: null | 'outside' | 'unverifiable' };

const isCleared = (e: unknown) => e instanceof TracingError && e.code === 'context-cleared';
/** Mark a gesture invalid; the first reason is kept and nothing ever clears it (sticky). */
const invalidateSample = (g: Gesture, why: 'outside' | 'unverifiable') => { if (!g.invalid) g.invalid = why; };

export function PalmTracingPanel({ context, imageSource, onClose, onRestart }: PalmTracingPanelProps) {
  const ids = useId();
  const instructionId = `${ids}-instruction`;
  const inputNoteId = `${ids}-input`;
  const feedbackId = `${ids}-feedback`;

  // One model per construction context. A context that is no longer active gives no model (photo already gone).
  const model = useMemo<TracingModel | null>(() => {
    try { return createTracingModel(context); } catch { return null; }
  }, [context]);
  const modelRef = useRef<TracingModel | null>(model);
  modelRef.current = model;

  const data = useMemo(() => context.read(), [context]);
  const imgW = data?.imageWidth ?? 0;
  const imgH = data?.imageHeight ?? 0;

  const [cleared, setCleared] = useState<boolean>(model === null || data === null);
  const readViews = useCallback((m: TracingModel | null): readonly TracingLineView[] | null => {
    if (!m) return null;
    try { return m.lines(); } catch (e) { if (isCleared(e)) return null; throw e; }
  }, []);
  const [views, setViews] = useState<readonly TracingLineView[] | null>(() => readViews(model));
  const [guides, setGuides] = useState<ReturnType<TracingModel['guides']> | null>(() => { try { return model ? model.guides() : null; } catch { return null; } });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<TracingPoint[] | null>(null);
  const [message, setMessage] = useState('');
  const gesture = useRef<Gesture | null>(null);
  const gestureEpoch = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // P4-I3 review state: explicit answers only (never defaulted), and a confirmation bound to what was reviewed.
  const [mode, setMode] = useState<'trace' | 'review' | 'result'>('trace');
  const [hand, setHand] = useState<ReviewHand | null>(null);
  const [dominant, setDominant] = useState<ReviewDominant | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null); // the review key the acknowledgement was given for
  const [confirmed, setConfirmed] = useState<ConfirmedFeatures | null>(null);

  /** Invalidate any pending gesture (see the gesture contract): an explicit decision always wins over a held pointer. */
  const invalidateGesture = useCallback(() => {
    gestureEpoch.current += 1;
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (g) { try { stageRef.current?.releasePointerCapture(g.id); } catch { /* not captured */ } }
  }, []);

  // A new context (photo replacement) starts over: fresh model, first step, no gesture, no draft.
  useEffect(() => {
    invalidateGesture();
    setStep(0);
    setMessage('');
    setMode('trace'); setHand(null); setDominant(null); setAcknowledged(null); setConfirmed(null);
    const v = readViews(model);
    setViews(v);
    try { setGuides(model ? model.guides() : null); } catch { setGuides(null); }
    setCleared(!v || !data);
  }, [model, data, readViews, invalidateGesture]);

  const markCleared = useCallback(() => {
    invalidateGesture();
    try { modelRef.current?.lines(); } catch { /* a revoked model discards its own traces on this call */ }
    setViews(null);
    setGuides(null);
    setConfirmed(null); setAcknowledged(null); setMode('trace');
    setCleared(true);
    setMessage('This photo was replaced or removed, so its traces were cleared.');
  }, [invalidateGesture]);

  /** Run a model operation; refresh the views; a revoked context clears the panel. */
  const run = useCallback(<T,>(op: (m: TracingModel) => T): T | undefined => {
    const m = modelRef.current;
    if (!m || cleared) return undefined;
    try {
      const out = op(m);
      setViews(m.lines());
      return out;
    } catch (e) {
      if (isCleared(e)) { markCleared(); return undefined; }
      // Model refusals are controlled outcomes, never uncaught errors; the model state is unchanged.
      if (e instanceof TracingError) { setMessage(e.code === 'too-many-points' ? POINT_LIMIT_TEXT : 'That change could not be made. Nothing was changed.'); return undefined; }
      throw e;
    }
  }, [cleared, markCleared]);
  /** An explicit user decision: invalidate any pending gesture first, then apply it. */
  const decide = <T,>(op: (m: TracingModel) => T): T | undefined => { invalidateGesture(); return run(op); };

  // The context can be revoked while the panel is idle (the photo was cleared elsewhere): watch it, so a revoked
  // photo and its traces never stay on screen and no later event can bring them back.
  useEffect(() => {
    if (cleared || !model) return;
    const watch = () => { if (!model.isActive()) markCleared(); };
    const timer = setInterval(watch, 250);
    return () => clearInterval(timer);
  }, [model, cleared, markCleared]);

  // ---------------------------------------------------------------- layout (one geometry for drawing and input)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The stage element is tracked as state so the measurement re-attaches whenever it (re)mounts.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((el: HTMLDivElement | null) => { stageRef.current = el; setStageEl(el); }, []);
  const [stageBox, setStageBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = stageEl;
    if (!el) return;
    const measure = () => {
      if (modelRef.current && !modelRef.current.isActive()) { markCleared(); return; } // a late observer callback restores nothing
      const r = el.getBoundingClientRect();
      setStageBox((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = RO ? new RO(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [stageEl, markCleared]);
  const content = useMemo(() => containRect({ left: 0, top: 0, width: stageBox.width, height: stageBox.height }, imgW, imgH), [stageBox, imgW, imgH]);
  const hasContent = content !== null;

  // The overlay's own copy of the photo, drawn once per photo; cleared on unmount or replacement.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !imgW || !imgH || cleared) return;
    c.width = imgW;
    c.height = imgH;
    const ctx = c.getContext('2d');
    try { ctx?.drawImage(imageSource, 0, 0, imgW, imgH); } catch { /* a released source draws nothing */ }
    return () => { c.width = 0; c.height = 0; };
  }, [imageSource, imgW, imgH, cleared, hasContent]);

  // Teardown: invalidate the gesture (the model goes with the component).
  useEffect(() => () => { invalidateGesture(); }, [invalidateGesture]);

  /** Pointer position -> normalised image coordinate, through the stage's CURRENT box and the contain geometry. */
  const toImage = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el || !imgW || !imgH) return null;
    const r = el.getBoundingClientRect();
    const c = containRect({ left: r.left, top: r.top, width: r.width, height: r.height }, imgW, imgH);
    return c ? clientToImage(clientX, clientY, c) : null;
  }, [imgW, imgH]);

  const lineId: PalmLineId = TRACING_LINES[Math.min(step, TRACING_LINES.length - 1)];
  const view = views?.find((v) => v.line === lineId) ?? null;
  const canDraw = !cleared && !!view && (view.status === 'not-started' || view.status === 'tracing');

  // ---------------------------------------------------------------- pointer input
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = modelRef.current;
    if (!m || cleared) return;
    if (!m.isActive()) { markCleared(); return; }
    if (gesture.current) return; // one gesture at a time: a second finger or pointer is ignored
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!canDraw) { setMessage(view?.status === 'confirmed' ? 'This line is confirmed. Choose Edit trace to change it.' : 'This line is skipped. Choose Trace this line to draw it.'); return; }
    const p = toImage(e.clientX, e.clientY);
    if (!p || !p.inside) { setMessage('Start the trace on the photo.'); return; }
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    gesture.current = { id: e.pointerId, epoch: gestureEpoch.current, model: m, line: lineId, pts: [{ x: p.x, y: p.y }], startClient: { x: e.clientX, y: e.clientY }, moved: false, invalid: null };
    setDraft([{ x: p.x, y: p.y }]);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    // Every sample the browser delivered for this event, coalesced ones included, in order (the event itself is last).
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const samples: Array<{ clientX: number; clientY: number }> = coalesced.length ? coalesced : [native];
    for (const sample of samples) {
      const p = toImage(sample.clientX, sample.clientY);
      if (!p) { invalidateSample(g, 'unverifiable'); continue; } // fail closed: an unmappable sample is never skipped
      if (!p.inside) invalidateSample(g, 'outside'); // validated before any spacing or simplification
      g.pts.push({ x: p.x, y: p.y });
      if (!g.moved && Math.hypot(sample.clientX - g.startClient.x, sample.clientY - g.startClient.y) > TRACING_TAP_SLOP_PX) g.moved = true;
    }
    setDraft(g.moved ? g.pts.slice() : [g.pts[0]]);
  };

  const finishGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    setDraft(null);
    // A gesture invalidated by a later decision, or begun on another model (photo replaced) or step, changes nothing.
    if (g.epoch !== gestureEpoch.current || g.model !== modelRef.current || g.line !== lineId) return;
    // The release position is part of the gesture, even without a final pointermove (never clamped; I1 judges it).
    const release = toImage(e.clientX, e.clientY);
    if (!release) invalidateSample(g, 'unverifiable'); // fail closed: an unmappable release is never skipped
    if (release) {
      const last = g.pts[g.pts.length - 1];
      if (last.x !== release.x || last.y !== release.y) g.pts.push({ x: release.x, y: release.y });
      if (!release.inside) invalidateSample(g, 'outside');
      if (!g.moved && Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) > TRACING_TAP_SLOP_PX) g.moved = true;
    }
    // R3: a gesture that left the photo at any delivered sample is refused before any spacing or simplification, so
    // neither the tap/drag classification nor stroke filtering can turn it into an eligible trace; the draft is unchanged.
    if (g.invalid) { setMessage(g.invalid === 'outside' ? GESTURE_OFF_PHOTO_TEXT : GESTURE_UNVERIFIABLE_TEXT); return; }
    run((m) => {
      if (m.line(g.line).status !== 'tracing') m.start(g.line);
      if (!g.moved) m.addPoint(g.line, g.pts[0]);
      else {
        const minStep = Math.max(2, 0.006 * Math.max(imgW, imgH));
        m.setTrace(g.line, resampleStroke(spaceStroke(g.pts, imgW, imgH, minStep), TRACING_STROKE_MAX_POINTS, imgW, imgH));
      }
      const placement = m.line(g.line).placement;
      setMessage(placement?.ok ? PLACEMENT_OK_TEXT : placement ? placementText(placement.reason) : '');
    });
  };

  const abortGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    setDraft(null);
    setMessage('Drawing was interrupted. Nothing was changed.');
  };

  // ---------------------------------------------------------------- actions (all keyboard-accessible buttons)
  const confirm = () => decide((m) => {
    const r = m.confirm(lineId);
    setMessage(r.ok ? `${LINE_COPY[lineId].title} confirmed.` : `Not confirmed. ${placementText(r.reason)}`);
  });
  const skip = (reason: 'user-skipped' | 'user-cannot-see') => decide((m) => {
    m.skip(lineId, reason);
    setMessage(reason === 'user-cannot-see' ? `${LINE_COPY[lineId].title} marked as not visible. It is not assessed.` : `${LINE_COPY[lineId].title} skipped. It is not assessed.`);
  });
  const reopen = () => decide((m) => { m.start(lineId); setMessage(`Editing the ${LINE_COPY[lineId].title.toLowerCase()}. Confirm it again when it is ready.`); });
  const clearLine = () => decide((m) => { m.reset(lineId); setMessage(`${LINE_COPY[lineId].title} cleared.`); });
  const undo = () => decide((m) => {
    const before = m.lines();
    if (!m.undo()) { setMessage('Nothing to undo.'); return; }
    const after = m.lines();
    const changed = TRACING_LINES.findIndex((_id, k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed >= 0) setStep(changed);
    setMessage(`Undid the last change${changed >= 0 ? ` (${LINE_COPY[TRACING_LINES[changed]].title})` : ''}.`);
  });
  const go = (k: number) => {
    invalidateGesture();
    setStep(Math.max(0, Math.min(TRACING_LINES.length - 1, k)));
    setMessage('');
  };

  // ---------------------------------------------------------------- P4-I3 review and confirmation
  const signature = useMemo(() => (views ? lineSignature(views) : ''), [views]);
  const reviewKey = `${context.generation}|${signature}|${hand ?? '-'}|${dominant ?? '-'}`;
  const reviewResult = useMemo<FeatureSetResult | null>(() => {
    if (mode !== 'review' || !hand || !dominant || !model || cleared) return null;
    try { return model.buildFeatureSet({ hand, dominantHand: dominant }); } catch { return null; } // a revoked context is cleared by the watch
    // signature: the features follow every change to the lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hand, dominant, model, cleared, signature]);
  const uncertain = hasUncertainty(reviewResult);
  const blockers = views ? reviewBlockers(views, hand, dominant, reviewResult, uncertain, acknowledged === reviewKey) : ['The photo is no longer available.'];
  const confirmedValid = !!confirmed && confirmed.key === reviewKey && !cleared;
  // A confirmation never outlives what it confirmed: any change to the lines, the hand answers or the photo withdraws it.
  useEffect(() => {
    if (confirmed && !confirmedValid) {
      setConfirmed(null);
      setMessage('You changed something after confirming, so the confirmation was withdrawn. Review the features again.');
    }
  }, [confirmed, confirmedValid]);
  const openReview = () => { invalidateGesture(); setMode('review'); setMessage(''); };
  const backToTracing = (line?: PalmLineId) => { invalidateGesture(); setMode('trace'); if (line) setStep(TRACING_LINES.indexOf(line)); setMessage(''); };
  const confirmFeatures = () => {
    invalidateGesture();
    const m = modelRef.current;
    if (!m || cleared) return;
    if (!m.isActive()) { markCleared(); return; }
    let fresh: readonly TracingLineView[];
    try { fresh = m.lines(); } catch (e) { if (isCleared(e)) { markCleared(); return; } throw e; }
    // never confirm something other than what is on screen
    if (lineSignature(fresh) !== signature) { setViews(fresh); setMessage('The lines changed while you were reviewing. Please review them again.'); return; }
    if (blockers.length || !hand || !dominant) { setMessage(blockers[0] ?? 'Not ready to confirm yet.'); return; }
    let r: FeatureSetResult;
    try { r = m.buildFeatureSet({ hand, dominantHand: dominant }); } catch (e) { if (isCleared(e)) { markCleared(); return; } throw e; }
    if (!r.ok) { setMessage('The features could not be put together. Nothing was confirmed.'); return; }
    // keep only I1's feature set (no landmarks, no photo), frozen; in memory only
    setConfirmed(Object.freeze({ key: reviewKey, featureSet: deepFreeze(JSON.parse(JSON.stringify(r.featureSet))), at: Date.now() }));
    setMessage('Features confirmed for this photo.');
  };

  // ---------------------------------------------------------------- render
  const scale = content && imgW ? content.width / imgW : 1;
  const px = (n: number) => n / (scale || 1); // CSS px -> image px (SVG user units)
  const pathOf = (pts: readonly unknown[]) => pts.filter((p): p is TracingPoint => !!p && typeof p === 'object').map((p) => `${p.x * imgW},${p.y * imgH}`).join(' ');
  const placement = view?.placement ?? null;
  const copy = LINE_COPY[lineId];

  if (cleared || !views || !view) {
    return (
      <section data-testid="palm-tracing" data-state="cleared" data-version={PALM_TRACING_UI_VERSION} style={panelStyle}>
        <p role="status" aria-live="polite" style={{ ...typography.body, margin: 0 }}>{message || 'This photo is no longer available for tracing.'}</p>
        {onClose && <button type="button" onClick={onClose} style={secondaryButton} data-testid="palm-tracing-close">Close tracing</button>}
      </section>
    );
  }

  const restartButton = onRestart ? <button type="button" onClick={() => { invalidateGesture(); onRestart(); }} data-testid="palm-scanner-restart" style={secondaryButton}>Start over</button> : null;

  // ---------------------------------------------------------------- P4-I4 result (only while the confirmation is valid)
  if (mode === 'result' && confirmedValid && confirmed) {
    const fs = confirmed.featureSet as Extract<FeatureSetResult, { ok: true }>['featureSet'];
    const lineText = (l: (typeof fs.lines)[PalmLineId]) => l.provenance === 'user-confirmed' ? '✓ Traced and confirmed by you'
      : l.reason === 'user-skipped' ? 'Skipped (not assessed)' : l.reason === 'user-cannot-see' ? 'You could not see it (not assessed)'
      : l.reason === 'not-requested' ? 'Not requested (optional)' : `Not assessed: ${l.reason}`;
    const hasNotAssessed = TRACING_LINES.some((id) => fs.lines[id].provenance !== 'user-confirmed') || fs.measurements.status !== 'measured' || fs.frame.qualityStatus !== 'accepted';
    return (
      <section data-testid="palm-scanner-result" data-version={PALM_FEATURE_REVIEW_VERSION} aria-labelledby={`${ids}-result-title`} style={panelStyle} className="aura-palm-tracing" data-lines={confirmedLineSummary(fs)}>
        <style>{FOCUS_CSS}</style>
        <ScannerSteps current={4} />
        <div>
          <h3 id={`${ids}-result-title`} style={{ ...typography.bodyStrong, margin: 0 }}><span aria-hidden="true">✓ </span>Your confirmed palm features</h3>
          <p style={{ ...typography.body, margin: `${spacing.xs}px 0 0` }}>{fs.hand.value === 'left' ? 'Left' : 'Right'} hand · dominant hand: {fs.dominantHand === 'unknown' ? 'not sure' : fs.dominantHand}.</p>
        </div>
        <div>
          <h4 style={subheading}>Lines</h4>
          <ul style={listStyle} data-testid="palm-result-lines">
            {TRACING_LINES.map((id) => (
              <li key={id} data-line={id} data-provenance={fs.lines[id].provenance} style={rowStyle}><strong>{LINE_COPY[id].title}</strong><span style={typography.caption}>{lineText(fs.lines[id])}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 style={subheading}>Hand proportions</h4>
          <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-result-measurement-status" data-status={fs.measurements.status}>Overall: {STATUS_TEXT_FRIENDLY[fs.measurements.status]}</p>
          <ReasonList codes={fs.measurements.reasons} testid="palm-result-reasons" />
          <ul style={listStyle} data-testid="palm-result-measurements">
            {Object.values(fs.measurements.measurements).map((mm) => (
              <li key={mm.id} data-measurement={mm.id} data-status={mm.status} style={{ ...rowStyle, flexWrap: 'wrap' }}>
                <span>{MEASUREMENT_LABELS[mm.id] ?? mm.id}</span>
                <span style={typography.caption}>{STATUS_TEXT_FRIENDLY[mm.status]}{mm.value !== null ? ` · ${mm.value}${mm.unit === 'ratio' ? '' : ' palm widths'}` : ''}</span>
                {mm.status !== 'measured' && mm.reasons.some((r) => !fs.measurements.reasons.includes(r)) && <div style={{ flexBasis: '100%' }}><ReasonList codes={mm.reasons.filter((r) => !fs.measurements.reasons.includes(r))} /></div>}
              </li>
            ))}
          </ul>
          <p style={{ ...typography.caption, margin: `${spacing.xs}px 0 0` }} data-testid="palm-result-quality" data-quality={fs.frame.qualityStatus}>Photo check: {fs.frame.qualityStatus === 'accepted' ? 'Accepted' : fs.frame.qualityStatus === 'needs-retake' ? '⚠ A better photo would help' : '⚠ Unknown'}{fs.frame.available ? '' : ' · the palm area could not be measured'}</p>
          <ReasonList codes={fs.frame.qualityIssues} testid="palm-result-quality-reasons" />
        </div>
        {hasNotAssessed && <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-result-not-assessed-note">Anything skipped, not visible, uncertain or not available stays that way. Nothing is guessed or filled in.</p>}
        <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-result-scope">{REVIEW_SCOPE_NOTE} A reading preview exists only as a separate development tool.</p>
        <p role="status" aria-live="polite" data-testid="palm-tracing-status" style={{ ...typography.caption, margin: 0, minHeight: '1.2em' }}>{message}</p>
        <div style={actionsRow}>
          <button type="button" onClick={() => { setMode('review'); setMessage(''); }} data-testid="palm-result-edit" style={secondaryButton}>Review or edit</button>
          {restartButton}
          {onClose && <button type="button" onClick={onClose} data-testid="palm-tracing-close" style={secondaryButton}>Close tracing</button>}
        </div>
      </section>
    );
  }

  if (mode === 'review' || mode === 'result') {
    const fs = reviewResult && reviewResult.ok ? reviewResult.featureSet : null;
    const lineLabel = (v: TracingLineView) => v.status === 'confirmed' ? '✓ Confirmed trace'
      : v.status === 'skipped' ? (v.skipReason === 'user-cannot-see' ? 'Can’t see it (not assessed)' : 'Skipped (not assessed)')
      : v.status === 'tracing' ? '⚠ Unconfirmed draft (needs a decision)'
      : REVIEW_PRIMARY_LINES.includes(v.line) ? '⚠ Not traced (needs a decision)' : 'Not requested (optional)';
    const statusWord = (st: string) => STATUS_TEXT_FRIENDLY[st] ?? st;
    const radio = (name: string, value: string, label: string, checked: boolean, onChange: () => void) => (
      <label key={value} style={radioLabel}><input type="radio" name={name} value={value} checked={checked} onChange={onChange} data-testid={`palm-review-${name}-${value}`} style={{ width: 20, height: 20 }} /> {label}</label>
    );
    return (
      <section data-testid="palm-review" data-version={PALM_FEATURE_REVIEW_VERSION} data-state={confirmedValid ? 'confirmed' : blockers.length ? 'blocked' : 'ready'} aria-labelledby={`${ids}-review-title`} style={panelStyle} className="aura-palm-tracing">
        <style>{FOCUS_CSS}</style>
        <ScannerSteps current={3} />
        <div>
          <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-review-progress">Final step: review and confirm</p>
          <h3 id={`${ids}-review-title`} style={{ ...typography.bodyStrong, margin: '2px 0 0' }}>Review your palm features</h3>
          <p style={{ ...typography.body, margin: `${spacing.xs}px 0 0` }}>Check each line and the hand details. Edit anything that is wrong before you confirm.</p>
        </div>

        <fieldset style={fieldsetStyle} data-testid="palm-review-hand">
          <legend style={legendStyle}>Which hand is in the photo?</legend>
          <div style={actionsRow}>{radio('hand', 'left', 'Left hand', hand === 'left', () => setHand('left'))}{radio('hand', 'right', 'Right hand', hand === 'right', () => setHand('right'))}</div>
        </fieldset>
        <fieldset style={fieldsetStyle} data-testid="palm-review-dominant">
          <legend style={legendStyle}>Which is your dominant hand?</legend>
          <div style={actionsRow}>{radio('dominant', 'left', 'Left', dominant === 'left', () => setDominant('left'))}{radio('dominant', 'right', 'Right', dominant === 'right', () => setDominant('right'))}{radio('dominant', 'unknown', 'Not sure', dominant === 'unknown', () => setDominant('unknown'))}</div>
        </fieldset>

        <div>
          <h4 style={subheading}>Lines (traced by you)</h4>
          <ul style={listStyle} data-testid="palm-review-lines">
            {views.map((v) => (
              <li key={v.line} data-line={v.line} data-status={v.status} data-skip-reason={v.skipReason ?? undefined} style={rowStyle}>
                <span><strong>{LINE_COPY[v.line].title}</strong><span style={{ ...typography.caption, display: 'block' }}>{lineLabel(v)}</span></span>
                <button type="button" onClick={() => backToTracing(v.line)} data-testid={`palm-review-edit-${v.line}`} style={secondaryButton}>Edit</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 style={subheading}>Hand proportions (measured automatically from the photo)</h4>
          {!fs && <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-review-features-pending">Answer the hand questions to see the measured proportions.</p>}
          {fs && (
            <>
              <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-review-measurement-status" data-status={fs.measurements.status}>Overall: {statusWord(fs.measurements.status)}</p>
              <ReasonList codes={fs.measurements.reasons} testid="palm-review-reasons" />
              <ul style={listStyle} data-testid="palm-review-measurements">
                {Object.values(fs.measurements.measurements).map((mm) => (
                  <li key={mm.id} data-measurement={mm.id} data-status={mm.status} style={rowStyle}>
                    <span>{MEASUREMENT_LABELS[mm.id] ?? mm.id}</span>
                    <span style={typography.caption}>{statusWord(mm.status)}{mm.value !== null ? ` · ${mm.value} ${mm.unit === 'ratio' ? '' : 'palm widths'}` : ''}</span>
                  </li>
                ))}
              </ul>
              <p style={{ ...typography.caption, margin: `${spacing.xs}px 0 0` }} data-testid="palm-review-quality" data-quality={fs.frame.qualityStatus}>Photo check: {fs.frame.qualityStatus === 'accepted' ? 'Accepted' : fs.frame.qualityStatus === 'needs-retake' ? '⚠ A better photo would help' : '⚠ Unknown'}{fs.frame.available ? '' : ' · the palm area could not be measured'}</p>
              <ReasonList codes={fs.frame.qualityIssues} testid="palm-review-quality-reasons" />
              <p style={{ ...typography.caption, margin: 0 }}>Marks: not part of this version (not requested).</p>
            </>
          )}
        </div>

        {uncertain && !confirmedValid && (
          <label style={radioLabel} data-testid="palm-review-ack-label">
            <input type="checkbox" checked={acknowledged === reviewKey} onChange={(e) => setAcknowledged(e.target.checked ? reviewKey : null)} data-testid="palm-review-ack" style={{ width: 20, height: 20 }} />
            I have seen the uncertain or unavailable items. They will stay marked that way.
          </label>
        )}

        {!confirmedValid && blockers.length > 0 && (
          <div role="status" aria-live="polite" data-testid="palm-review-blockers">
            <p style={{ ...typography.bodyStrong, margin: 0 }}>Before you can confirm:</p>
            <ul style={{ margin: 0, paddingLeft: spacing.lg }}>{blockers.map((b) => <li key={b} style={typography.body}>{b}</li>)}</ul>
          </div>
        )}
        {confirmedValid && (
          <div data-testid="palm-review-confirmed" data-lines={confirmed ? confirmedLineSummary(confirmed.featureSet) : ''} style={{ borderLeft: `3px solid ${colors.positive}`, paddingLeft: spacing.sm }}>
            <p style={{ ...typography.bodyStrong, margin: 0 }}><span aria-hidden="true">✓ </span>Features confirmed for this photo.</p>
            <p style={{ ...typography.caption, margin: 0 }}>Editing a line, changing a hand answer or changing the photo withdraws this confirmation.</p>
            <button type="button" onClick={() => { setMode('result'); setMessage(''); }} data-testid="palm-review-see-result" style={{ ...primaryButton, marginTop: spacing.xs }}>See your result</button>
          </div>
        )}
        <p role="status" aria-live="polite" data-testid="palm-tracing-status" style={{ ...typography.caption, margin: 0, minHeight: '1.2em' }}>{message}</p>

        <div style={actionsRow}>
          {!confirmedValid && <button type="button" onClick={confirmFeatures} disabled={blockers.length > 0} data-testid="palm-review-confirm" style={blockers.length ? disabledButton : primaryButton}>Confirm features</button>}
          <button type="button" onClick={() => backToTracing()} data-testid="palm-review-back" style={secondaryButton}>Back to tracing</button>
          {restartButton}
          {onClose && <button type="button" onClick={onClose} data-testid="palm-tracing-close" style={secondaryButton}>Close tracing</button>}
        </div>
        <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-review-scope">{REVIEW_SCOPE_NOTE}</p>
      </section>
    );
  }

  return (
    <section data-testid="palm-tracing" data-state="active" data-version={PALM_TRACING_UI_VERSION} aria-label="Trace palm lines" style={panelStyle} className="aura-palm-tracing">
      <style>{FOCUS_CSS}</style>
      <ScannerSteps current={2} />
      <ol aria-label="Tracing progress" data-testid="palm-tracing-steps" style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs, listStyle: 'none', padding: 0, margin: 0 }}>
        {views.map((v, k) => (
          <li key={v.line}>
            <button
              type="button"
              onClick={() => go(k)}
              aria-current={k === step ? 'step' : undefined}
              data-testid={`palm-tracing-step-${v.line}`}
              data-status={v.status}
              data-skip-reason={v.skipReason ?? undefined}
              style={{ ...stepButton, ...(k === step ? stepButtonCurrent : null) }}
            >
              <span style={{ fontWeight: 800 }}>{k + 1}. {LINE_COPY[v.line].title}</span>
              <span style={{ ...typography.caption, display: 'block' }}>{v.status === 'confirmed' ? '✓ ' : ''}{lineStatusText(v)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div>
        <p data-testid="palm-tracing-progress" style={{ ...typography.caption, margin: 0 }}>Line {step + 1} of {TRACING_LINES.length}</p>
        <h3 style={{ ...typography.bodyStrong, margin: `2px 0 0` }} data-testid="palm-tracing-title">{copy.title}</h3>
        <p id={instructionId} style={{ ...typography.body, margin: `${spacing.xs}px 0 0` }}>{copy.instruction}</p>
        <p style={{ ...typography.caption, margin: `${spacing.xs}px 0 0` }}>Also called {TRACING_LINE_NAMES[lineId].indian}. The dots show the finger bases and the wrist.</p>
      </div>

      <div
        ref={attachStage}
        data-testid="palm-tracing-stage"
        role="img"
        aria-label={`Your photo with the ${copy.title.toLowerCase()} trace`}
        aria-describedby={`${instructionId} ${inputNoteId} ${feedbackId}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={abortGesture}
        onLostPointerCapture={abortGesture}
        onContextMenu={(e) => e.preventDefault()}
        style={{ ...stageStyle, cursor: canDraw ? 'crosshair' : 'default' }}
      >
        {content && (
          <>
            <canvas
              ref={canvasRef}
              data-testid="palm-tracing-photo"
              aria-hidden="true"
              style={{ position: 'absolute', left: content.left, top: content.top, width: content.width, height: content.height, display: 'block', borderRadius: radius.sm }}
            />
            <svg
              data-testid="palm-tracing-overlay"
              aria-hidden="true"
              viewBox={`0 0 ${imgW} ${imgH}`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', left: content.left, top: content.top, width: content.width, height: content.height, overflow: 'visible', pointerEvents: 'none' }}
            >
              {guides && (Object.entries(guides.image) as Array<[string, TracingPoint]>).map(([name, g]) => (
                <circle key={name} data-guide={name} cx={g.x * imgW} cy={g.y * imgH} r={px(6)} fill="rgba(255,255,255,0.85)" stroke="#0b1020" strokeWidth={px(2)} />
              ))}
              {views.map((v) => v.points.length > 0 && (
                <polyline
                  key={v.line}
                  data-trace={v.line}
                  data-status={v.status}
                  points={pathOf(v.points)}
                  fill="none"
                  stroke={v.line === lineId ? (v.status === 'confirmed' ? colors.positive : colors.info) : 'rgba(248,250,252,0.55)'}
                  strokeWidth={px(v.line === lineId ? 4 : 2.5)}
                  strokeDasharray={v.status === 'confirmed' ? undefined : `${px(8)} ${px(5)}`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {view.points.length > 0 && view.status !== 'confirmed' && (view.points as TracingPoint[]).map((p, k) => (
                <circle key={k} data-point={k} cx={p.x * imgW} cy={p.y * imgH} r={px(4)} fill={colors.info} />
              ))}
              {draft && draft.length > 0 && (
                <polyline data-draft="1" points={pathOf(draft)} fill="none" stroke={colors.warning} strokeWidth={px(3)} strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </>
        )}
      </div>

      <p id={inputNoteId} style={{ ...typography.caption, margin: 0 }}>{TRACING_INPUT_NOTE}</p>

      <div id={feedbackId} data-testid="palm-tracing-feedback" data-placement={placement ? (placement.ok ? 'ok' : placement.reason) : 'none'} style={{ ...typography.body, margin: 0 }}>
        {view.status === 'tracing' && view.points.length > 0 && placement && (
          <p style={{ margin: 0 }}><span aria-hidden="true">{placement.ok ? '✓ ' : '⚠ '}</span><strong>{placement.ok ? 'Shape check passed. ' : 'Shape check: not yet. '}</strong>{placement.ok ? PLACEMENT_OK_TEXT : placementText(placement.reason)}</p>
        )}
        {view.status === 'confirmed' && <p style={{ margin: 0 }}><span aria-hidden="true">✓ </span>Confirmed. Choose Edit trace to change it.</p>}
        {view.status === 'skipped' && <p style={{ margin: 0 }}>{view.skipReason === 'user-cannot-see' ? 'Marked as not visible. This line is not assessed.' : 'Skipped. This line is not assessed.'}</p>}
      </div>
      <p role="status" aria-live="polite" data-testid="palm-tracing-status" style={{ ...typography.caption, margin: 0, minHeight: '1.2em' }}>{message}</p>

      <div style={actionsRow}>
        {view.status === 'tracing' && (
          <button type="button" onClick={confirm} disabled={!placement?.ok} aria-describedby={feedbackId} data-testid="palm-tracing-confirm" style={placement?.ok ? primaryButton : disabledButton}>Confirm trace</button>
        )}
        {view.status === 'confirmed' && <button type="button" onClick={reopen} data-testid="palm-tracing-edit" style={secondaryButton}>Edit trace</button>}
        {view.status === 'skipped' && <button type="button" onClick={reopen} data-testid="palm-tracing-retrace" style={secondaryButton}>Trace this line</button>}
        <button type="button" onClick={undo} data-testid="palm-tracing-undo" style={secondaryButton}>Undo</button>
        {(view.points.length > 0 || view.status === 'skipped' || view.status === 'confirmed') && (
          <button type="button" onClick={clearLine} data-testid="palm-tracing-clear" style={secondaryButton}>Clear line</button>
        )}
      </div>
      <div style={actionsRow}>
        <button type="button" onClick={() => skip('user-skipped')} data-testid="palm-tracing-skip" aria-pressed={view.status === 'skipped' && view.skipReason === 'user-skipped'} style={secondaryButton}>Skip</button>
        <button type="button" onClick={() => skip('user-cannot-see')} data-testid="palm-tracing-cannot-see" aria-pressed={view.status === 'skipped' && view.skipReason === 'user-cannot-see'} style={secondaryButton}>I can’t see this line</button>
      </div>

      <div style={{ ...actionsRow, justifyContent: 'space-between' }}>
        <button type="button" onClick={() => go(step - 1)} disabled={step === 0} data-testid="palm-tracing-back" style={step === 0 ? disabledButton : secondaryButton}>Back</button>
        {onClose && <button type="button" onClick={onClose} data-testid="palm-tracing-close" style={secondaryButton}>Close tracing</button>}
        <button type="button" onClick={() => go(step + 1)} disabled={step === TRACING_LINES.length - 1} data-testid="palm-tracing-next" style={step === TRACING_LINES.length - 1 ? disabledButton : secondaryButton}>Next line</button>
      </div>

      <div style={actionsRow}>
        <button type="button" onClick={openReview} data-testid="palm-review-open" style={primaryButton}>Review all lines</button>
        {restartButton}
      </div>
      {confirmedValid && <p data-testid="palm-review-confirmed-banner" style={{ ...typography.caption, margin: 0 }}><span aria-hidden="true">✓ </span>Features confirmed for this photo. Any change withdraws the confirmation.</p>}
      <p style={{ ...typography.caption, margin: 0 }} data-testid="palm-tracing-scope">{TRACING_SCOPE_NOTE}</p>
    </section>
  );
}

const FOCUS_CSS = '.aura-palm-tracing button:focus-visible{outline:3px solid ' + colors.borderFocus + ';outline-offset:2px}';

const panelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: spacing.md };
const stageStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 'min(62vh, 560px)',
  minHeight: 240,
  touchAction: 'none', // only the drawing surface: the page still scrolls everywhere else
  userSelect: 'none',
  WebkitUserSelect: 'none',
  overflow: 'hidden',
  background: 'rgba(2, 6, 23, 0.6)',
  borderRadius: radius.md,
};
const tracingButtonBase: React.CSSProperties = { minHeight: 48, minWidth: 48, padding: `0 ${spacing.md}px`, borderRadius: radius.md, fontSize: 15, fontWeight: 800, cursor: 'pointer' };
const primaryButton: React.CSSProperties = { ...tracingButtonBase, border: 'none', background: colors.traditional, color: '#0b1020' };
const secondaryButton: React.CSSProperties = { ...tracingButtonBase, border: `1px solid ${colors.borderDefault}`, background: colors.surfaceSubtle, color: colors.textPrimary };
const disabledButton: React.CSSProperties = { ...secondaryButton, opacity: 0.5, cursor: 'not-allowed' };
const actionsRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: spacing.sm };
const fieldsetStyle: React.CSSProperties = { border: `1px solid ${colors.borderDefault}`, borderRadius: radius.md, padding: spacing.sm, margin: 0 };
const legendStyle: React.CSSProperties = { ...typography.bodyStrong, padding: `0 ${spacing.xs}px` };
const radioLabel: React.CSSProperties = { ...typography.body, display: 'inline-flex', alignItems: 'center', gap: spacing.xs, minHeight: 48, cursor: 'pointer' };
const subheading: React.CSSProperties = { ...typography.bodyStrong, margin: `0 0 ${spacing.xs}px` };
const listStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: spacing.xs };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 48, borderBottom: `1px solid ${colors.borderSubtle}` };
const stepButton: React.CSSProperties = { ...secondaryButton, minHeight: 48, padding: `${spacing.xs}px ${spacing.sm}px`, textAlign: 'left', fontSize: 13 };
const stepButtonCurrent: React.CSSProperties = { border: `2px solid ${colors.traditional}`, background: colors.traditionalSoft };

