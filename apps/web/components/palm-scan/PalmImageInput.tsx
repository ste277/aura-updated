'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PALM_SCOPE_NOTE } from '../../lib/palm-analysis/analyze';
import { isPalmImageInputEnabled } from '../../lib/palm-analysis/gate';
import { createMediaPipeHandDetector } from '../../lib/palm-analysis/mediapipeDetector';
import { createPalmAnalysisSession, type PalmAnalysisSession, type PalmSessionDeps, type PalmSessionState } from '../../lib/palm-analysis/session';
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
    const unsubscribe = session.subscribe(setState);
    // Leaving the page (tab close, navigation, bfcache) clears the image.
    const onPageHide = () => session.clear();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
      session.dispose(); // releases the frame and closes the model
      sessionRef.current = null;
      if (previewRef.current) previewRef.current.replaceChildren();
    };
    // sessionDeps is a test seam and intentionally read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frame = state?.frame ?? null;
  const phase = state?.phase ?? 'idle';

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
          style={{ position: 'relative', width: '100%', maxWidth: hasImage ? `min(100%, ${Math.round(360 * aspect)}px)` : undefined, alignSelf: 'center', opacity: busy ? 0.7 : 1 }}
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
