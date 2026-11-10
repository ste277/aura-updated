// AURA-MCP-02-I1: the schema now lives in packages/mcp-tools so the local
// stdio server and the remote HTTP server share one definition. This module
// re-exports it unchanged for existing importers.
export * from '../../../../packages/mcp-tools/src/findBestTimeSchema';
