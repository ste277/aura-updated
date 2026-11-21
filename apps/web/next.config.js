const { applyPalmistryExclusion } = require('./palmistry-build-exclusion');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (deploy/Dockerfile) —
  // copies only the files the server actually needs instead of node_modules.
  output: 'standalone',
  // Keep the hot-reload output isolated from production builds.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // The packages/ folder lives outside apps/web (monorepo layout), so Next
  // needs to be told to transpile those workspace-relative imports too.
  experimental: {
    externalDir: true,
    // AURA-MCP-02-I2a-R1 F15: the local OAuth module is only reachable behind
    // a literal NODE_ENV !== 'production' block, so no production chunk
    // contains it; this also keeps the file tracer from copying its source
    // into server/standalone output.
    outputFileTracingExcludes: {
      '*': ['./lib/mcpLocalOAuth.ts'],
    },
  },
  // AURA-MCP-02-I2a: public OAuth paths -> the Pages API mount
  // (pages/api/oauth/[...oidc].ts). That route answers 404 unless the local
  // development gate (lib/mcpAuthGate.ts) allows it, so in Production these
  // rewrites lead to a 404 exactly like a missing route.
  async rewrites() {
    return [
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/.well-known/oauth-authorization-server' },
      { source: '/.well-known/openid-configuration', destination: '/api/oauth/.well-known/openid-configuration' },
      { source: '/oauth/:path*', destination: '/api/oauth/oauth/:path*' },
    ];
  },
  // AURA-PALM-01-P1: production builds exclude unapproved Palmistry content
  // entirely (see palmistry-build-exclusion.js). `next dev` is unaffected.
  webpack(config, { dev, webpack }) {
    return applyPalmistryExclusion(config, { dev, webpack });
  },
};

module.exports = nextConfig;
