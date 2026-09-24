'use client';

import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography } from '../../components/theme';
import { PageHeader, SurfaceCard, PrimaryButton, SecondaryButton, TextButton, StatusBadge, FieldLabel, FieldError, TextInput } from '../../components/ui';
import { isCaptureActionable, presentCaptureStateLabel, buildCapturePlanHref, type CaptureItem } from '../../lib/capturesPresentation';

/**
 * Quick Capture V1 PR B -- the smallest useful surface: a one-line composer
 * and the active (OPEN + PLANNED) list. An OPEN row can be selected for
 * "Plan with Aura", marked Done, or removed; a PLANNED row is read-only
 * ("Planned") because completion belongs to the linked plan. Selection is
 * pure local state. Rows never disappear before the server confirms.
 */

type LoadState = { status: 'LOADING' } | { status: 'LOADED'; items: CaptureItem[] } | { status: 'ERROR' };

export function CapturesClient({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated) window.location.href = '/';
  }, [authenticated]);
  if (!authenticated) return null;
  return <CapturesView />;
}

function CapturesView() {
  const [state, setState] = useState<LoadState>({ status: 'LOADING' });
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const [navigating, setNavigating] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/captures');
      if (!res.ok) throw new Error('failed');
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error('failed');
      setState({ status: 'LOADED', items });
    } catch {
      setState({ status: 'ERROR' });
    }
  };

  useEffect(() => {
    void load();
    // Returning via the browser's back button (bfcache) must never show a
    // stale Planned/Open state after planning happened elsewhere.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const items = state.status === 'LOADED' ? state.items : [];
  const openIds = new Set(items.filter((item) => isCaptureActionable(item.derivedState)).map((item) => item.id));
  const effectiveSelectedIds = items.filter((item) => selectedIds.has(item.id) && openIds.has(item.id)).map((item) => item.id);

  const trimmed = title.trim();
  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: trimmed }) });
      const created = await res.json().catch(() => null);
      if (!res.ok || !created?.id) {
        setAddError(res.status === 400 ? (created?.error ?? 'Please check what you wrote.') : "Couldn't save that. Your words are still here -- try again.");
        return;
      }
      setState((current) => (current.status === 'LOADED' ? { status: 'LOADED', items: [created, ...current.items] } : current));
      setTitle('');
    } catch {
      setAddError("Couldn't save that. Your words are still here -- try again.");
    } finally {
      setAdding(false);
    }
  };

  const withRowPending = async (id: string, run: () => Promise<boolean>, failureCopy: string) => {
    if (pendingIds.has(id)) return;
    setPendingIds((current) => new Set(current).add(id));
    setRowErrors((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      const ok = await run();
      if (ok) {
        setState((current) => (current.status === 'LOADED' ? { status: 'LOADED', items: current.items.filter((item) => item.id !== id) } : current));
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        // The acted-on row is gone -- keep keyboard focus somewhere sensible.
        composerRef.current?.focus();
      } else {
        setRowErrors((current) => ({ ...current, [id]: failureCopy }));
        // The server may know something the page doesn't (e.g. it was just planned) -- re-sync.
        void load();
      }
    } catch {
      setRowErrors((current) => ({ ...current, [id]: failureCopy }));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDone = (id: string) => withRowPending(id, async () => (await fetch(`/api/captures/${id}/complete`, { method: 'POST' })).ok, "Couldn't mark that done. Try again.");
  const handleRemove = (id: string) => withRowPending(id, async () => (await fetch(`/api/captures/${id}`, { method: 'DELETE' })).ok, "Couldn't remove that. If it's planned, cancel the plan first.");

  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handlePlan = () => {
    if (effectiveSelectedIds.length === 0 || navigating) return;
    setNavigating(true);
    window.location.href = buildCapturePlanHref(effectiveSelectedIds);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ marginBottom: spacing.lg }}>
          <TextButton onClick={() => { window.location.href = '/'; }} color={colors.textMuted}>
            ← Back to Home
          </TextButton>
        </div>

        <PageHeader title="Things you want to do" />

        <form onSubmit={handleAdd} style={{ marginTop: spacing.xl }}>
          <FieldLabel htmlFor="capture-composer">What&apos;s on your mind?</FieldLabel>
          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextInput id="capture-composer" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Call John" readOnly={adding} ref={composerRef} autoComplete="off" />
            </div>
            <PrimaryButton type="submit" disabled={!trimmed} loading={adding}>
              Add
            </PrimaryButton>
          </div>
          {state.status === 'LOADED' && items.length === 0 && <p style={{ ...typography.body, marginTop: spacing.sm }}>Capture something you want to do. Aura will help find the time.</p>}
          {addError && (
            <div role="alert" style={{ marginTop: spacing.sm }}>
              <FieldError>{addError}</FieldError>
            </div>
          )}
        </form>

        <div style={{ marginTop: spacing.xl }}>
          {state.status === 'LOADING' && (
            <div aria-busy="true" aria-label="Loading">
              <SurfaceCard style={{ opacity: 0.5 }}>
                <div style={{ height: 14, width: '55%', background: colors.borderSubtle, borderRadius: 6 }} />
              </SurfaceCard>
            </div>
          )}

          {state.status === 'ERROR' && (
            <SurfaceCard>
              <FieldError>Couldn&apos;t load your list.</FieldError>
              <div style={{ marginTop: spacing.md }}>
                <SecondaryButton onClick={() => { setState({ status: 'LOADING' }); void load(); }}>Try again</SecondaryButton>
              </div>
            </SurfaceCard>
          )}

          {state.status === 'LOADED' && items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              {items.map((item) => {
                const actionable = isCaptureActionable(item.derivedState);
                const pending = pendingIds.has(item.id);
                const label = presentCaptureStateLabel(item.derivedState);
                return (
                  <li key={item.id}>
                    <SurfaceCard style={selectedIds.has(item.id) && actionable ? { borderColor: colors.accentBorder } : undefined}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, minWidth: 0, cursor: actionable ? 'pointer' : 'default' }}>
                          {actionable && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelected(item.id)}
                              disabled={pending}
                              aria-label={`Select "${item.title}" to plan with Aura`}
                              style={{ width: 18, height: 18, flexShrink: 0, accentColor: colors.positive }}
                            />
                          )}
                          <span style={{ ...typography.bodyStrong, minWidth: 0, overflowWrap: 'anywhere' }}>{item.title}</span>
                        </label>
                        {label && <StatusBadge label={label} tone="info" />}
                      </div>
                      {rowErrors[item.id] && (
                        <div role="alert" style={{ marginTop: spacing.sm }}>
                          <FieldError>{rowErrors[item.id]}</FieldError>
                        </div>
                      )}
                      {actionable && (
                        <div style={{ display: 'flex', gap: spacing.lg, marginTop: spacing.sm }}>
                          <TextButton onClick={() => void handleDone(item.id)} color={colors.textSecondary} ariaLabel={`Mark "${item.title}" done`}>
                            {pending ? 'Working…' : 'Done'}
                          </TextButton>
                          <TextButton onClick={() => void handleRemove(item.id)} color={colors.textFaint} ariaLabel={`Remove "${item.title}"`}>
                            Remove
                          </TextButton>
                        </div>
                      )}
                    </SurfaceCard>
                  </li>
                );
              })}
            </ul>
          )}

          {effectiveSelectedIds.length > 0 && (
            <div style={{ marginTop: spacing.lg }}>
              <PrimaryButton onClick={handlePlan} loading={navigating}>
                Plan with Aura{effectiveSelectedIds.length > 1 ? ` (${effectiveSelectedIds.length})` : ''}
              </PrimaryButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
