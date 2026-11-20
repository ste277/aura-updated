const { applyPalmistryExclusion } = require('./palmistry-build-exclusion');
const { applyPalmImageInputExclusion } = require('./palm-image-input-build-exclusion');

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
  },
  // AURA-PALM-01-P1: production builds exclude unapproved Palmistry content
  // entirely (see palmistry-build-exclusion.js). `next dev` is unaffected.
  // AURA-PALM-G5-I1-R2: palm IMAGE INPUT (upload UI, on-device pipeline,
  // MediaPipe) is excluded from every production build independently of the
  // content approval (see palm-image-input-build-exclusion.js).
  webpack(config, { dev, webpack }) {
    return applyPalmImageInputExclusion(applyPalmistryExclusion(config, { dev, webpack }), { dev, webpack });
  },
};

module.exports = nextConfig;
