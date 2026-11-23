import { notFound } from 'next/navigation';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';
import { resolveRuntimeMcpAuthMode } from '../../../lib/mcpAuthGate';
import { safeOAuthReturnTo } from '../../../lib/mcpConnectReturn';
import { ConnectSignInClient } from './ConnectSignInClient';

/**
 * AURA-MCP-02-I2b -- sign in, then return to the assistant-connection
 * (OAuth consent) page. Uses the existing LoginScreen unchanged. Exists only
 * where the OAuth authorization server is enabled (404 otherwise).
 */
export const dynamic = 'force-dynamic';

export default function ConnectSignInPage({ searchParams }: { searchParams: { returnTo?: string | string[] } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  if (resolveRuntimeMcpAuthMode(remoteMcpConfigFromEnv()).mode !== 'local') notFound();
  const returnTo = safeOAuthReturnTo(searchParams.returnTo);
  return <ConnectSignInClient returnTo={returnTo} />;
}
