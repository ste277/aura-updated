/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The packages/ folder lives outside apps/web (monorepo layout), so Next
  // needs to be told to transpile those workspace-relative imports too.
  experimental: {
    externalDir: true,
  },
};

module.exports = nextConfig;
