'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Connection {
  clientId: string;
  label: string;
  connectedAt: number | null;
}

type State = { kind: 'loading' } | { kind: 'signed_out' } | { kind: 'error' } | { kind: 'ready'; connections: Connection[] };

export function ConnectedAppsClient() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/connections', { cache: 'no-store' });
      if (res.status === 401) return setState({ kind: 'signed_out' });
      if (!res.ok) return setState({ kind: 'error' });
      const data = (await res.json()) as { connections: Connection[] };
      setState({ kind: 'ready', connections: data.connections });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(c: Connection) {
    setBusy(c.clientId);
    setNotice(null);
    try {
      const res = await fetch('/api/mcp/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: c.clientId }) });
      setNotice(res.ok ? `${c.label} was disconnected. It can no longer use your Aura account.` : 'Disconnecting failed. Try again.');
    } catch {
      setNotice('Disconnecting failed. Check your connection and try again.');
    } finally {
      setBusy(null);
      void load();
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px', fontFamily: 'var(--as-font-body)', color: 'var(--as-text)' }}>
      <h1 style={{ fontSize: 22 }}>Connected assistants</h1>
      {notice ? <p role="status">{notice}</p> : null}
      {state.kind === 'loading' ? <p>Loading…</p> : null}
      {state.kind === 'signed_out' ? (
        <p>
          Your session has ended. <a href="/">Sign in</a> to manage connected assistants.
        </p>
      ) : null}
      {state.kind === 'error' ? <p>Connected assistants could not be loaded. Try again later.</p> : null}
      {state.kind === 'ready' && state.connections.length === 0 ? <p>No assistants are connected to your Aura account.</p> : null}
      {state.kind === 'ready' && state.connections.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {state.connections.map((c) => (
            <li key={c.clientId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--as-border)' }}>
              <span>
                <strong>{c.label}</strong>
                <br />
                <small>Read-only access to Aura's timing search{c.connectedAt ? ` · connected ${new Date(c.connectedAt * 1000).toLocaleDateString()}` : ''}</small>
              </span>
              <button type="button" disabled={busy === c.clientId} onClick={() => void disconnect(c)} style={{ padding: '8px 14px' }}>
                {busy === c.clientId ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
