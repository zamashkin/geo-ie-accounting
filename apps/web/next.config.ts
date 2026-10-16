import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript sources; Next compiles them with the app.
  transpilePackages: ['@ie-ledger/contracts', '@ie-ledger/domain', '@ie-ledger/ui'],
  poweredByHeader: false,
  typedRoutes: true,
  // The floating dev-tools badge covers page content in local use and e2e screenshots.
  devIndicators: false,
};

export default nextConfig;
