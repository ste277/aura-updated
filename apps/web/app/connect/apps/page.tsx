import { notFound } from 'next/navigation';
import { AccountScoped } from '../../../components/AccountScoped';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';
import { resolveRuntimeMcpAuthMode } from '../../../lib/mcpAuthGate';
import { ConnectedAppsClient } from './ConnectedAppsClient';

/**
 * AURA-MCP-02-I2b -- connected assistants: list and disconnect (revokes the
 * grant and every token issued under it). Exists only where the OAuth
 * authorization server is enabled (404 otherwise).
 */
export const dynamic = 'force-dynamic';

export default function ConnectedAppsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  if (resolveRuntimeMcpAuthMode(remoteMcpConfigFromEnv()).mode !== 'local') notFound();
  // AURA-ANDROID-REL-04 (R3): client-fetched account data -> remount on account change.
  return <AccountScoped><ConnectedAppsClient /></AccountScoped>;
}
