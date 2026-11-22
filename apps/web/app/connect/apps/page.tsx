import { notFound } from 'next/navigation';
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
  return <ConnectedAppsClient />;
}
