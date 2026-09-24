'use client';

import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, TextButton, FieldLabel, FieldError, TextInput } from './ui';
import { validateCaptureTitle, MAX_CAPTURE_TITLE_LENGTH } from '../lib/captures';
import { createQuickCaptureSubmitter } from '../lib/quickCaptureSubmit';

/**
 * Quick Capture V1 PR C -- the lightweight Home composer opened by
 * "+ Add something". Title only, submitted through the existing
 * POST /api/captures (the same write path as the "Things you want to do"
 * page), never a second domain write. It only CAPTURES: no planning, no Day
 * Constructor, no Timing Search.
 *
 * A submitter-held in-flight flag (createQuickCaptureSubmitter) blocks
 * synchronous duplicate submits -- React state updates are not visible to a
 * second click dispatched in the same task. On success the parent closes this composer and returns focus to the
 * opener -- this component never re-focuses an input after success, so a
 * phone keyboard is not summoned again.
 */
export function HomeQuickCapture({
  onClose,
  onSaved,
  onSeeSuggestions,
}: {
  onClose: () => void;
  onSaved: () => void;
  /** The existing "+ Add something" behavior (Day Builder suggestions / Explore), kept reachable. */
  onSeeSuggestions?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitter = useRef(createQuickCaptureSubmitter());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const checked = validateCaptureTitle(title);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!checked.ok) return;
    setSubmitting(true);
    setError(null);
    const result = await submitter.current(title);
    if (result === 'BUSY') return; // the first submit owns the UI state
    setSubmitting(false);
    if (result === 'SAVED') onSaved();
    else if (result === 'REJECTED') setError('Please check what you wrote and try again.');
    else if (result === 'FAILED') setError("Couldn't save that. Your words are still here -- try again.");
  };

  return (
    <SurfaceCard style={{ marginBottom: spacing.md }}>
      <form
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <FieldLabel htmlFor="home-capture-input">What do you want to do?</FieldLabel>
        <TextInput
          id="home-capture-input"
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_CAPTURE_TITLE_LENGTH}
          placeholder="Call John"
          readOnly={submitting}
          autoComplete="off"
        />
        <p style={{ ...typography.meta, marginTop: spacing.xs }}>Aura can help you find time for it later.</p>
        {error && (
          <div role="alert" style={{ marginTop: spacing.sm }}>
            <FieldError>{error}</FieldError>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <SecondaryButton onClick={onClose} disabled={submitting}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={!checked.ok} loading={submitting}>
              Add
            </PrimaryButton>
          </div>
          {onSeeSuggestions && (
            <TextButton onClick={onSeeSuggestions} color={colors.textMuted}>
              See suggestions
            </TextButton>
          )}
        </div>
      </form>
    </SurfaceCard>
  );
}
