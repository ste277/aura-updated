'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AccountScoped } from '../../components/AccountScoped';
import { PlanDayClient, type PlanDayClientProps } from './PlanDayClient';

/**
 * AURA-ANDROID-REL-04 IR-01 (R5) -- Plan Day's account-derived bootstrap is
 * fetched only after the client verified the signed-in account
 * (AccountScoped `verified`), from the account-scoped
 * GET /api/plan-day/bootstrap: the shared fetch boundary states the verified
 * account, and the server refuses it for any other session. A changed account
 * remounts this loader, which fetches again for the account now verified. The
 * horizon/handoff query parameters are forwarded unchanged.
 */
type Load = { status: 'loading' } | { status: 'ready'; props: PlanDayClientProps } | { status: 'failed' };

const SIGNED_OUT: PlanDayClientProps = { timezone: null, planningDate: null, horizon: null, availabilityConfigured: null, locationConfirmed: null, cityName: null, goalActivities: [], captures: [], autoGoalSuggestions: [] };

function Bootstrap({ query }: { query: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(`/api/plan-day/bootstrap${query ? `?${query}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error(String(res.status));
        const props = (await res.json()) as PlanDayClientProps;
        if (alive) setLoad({ status: 'ready', props });
      } catch {
        // Includes a refusal by the account boundary (the account changed: this tree is about to be replaced).
        if (alive) setLoad({ status: 'failed' });
      }
    })();
    return () => { alive = false; };
  }, [query, tick]);
  if (load.status === 'loading') return <div role="status" data-plan-day="loading" style={{ padding: 24, color: '#cbd5e1' }}>Loading your day…</div>;
  if (load.status === 'failed') {
    return (
      <div role="alert" data-plan-day="failed" style={{ padding: 24, color: '#cbd5e1' }}>
        Aura couldn&apos;t load your day.{' '}
        <button type="button" onClick={() => setTick((t) => t + 1)}>Try again</button>
      </div>
    );
  }
  return <PlanDayClient {...load.props} />;
}

export function PlanDayLoader() {
  const query = useSearchParams()?.toString() ?? '';
  return (
    <AccountScoped verified>
      {(account) => (account === null ? <PlanDayClient {...SIGNED_OUT} /> : <Bootstrap key={query} query={query} />)}
    </AccountScoped>
  );
}
