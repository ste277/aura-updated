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
};

module.exports = nextConfig;
