import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript sources; Next compiles them with the app.
  transpilePackages: [
    '@geo-ie-accounting/contracts',
    '@geo-ie-accounting/domain',
    '@geo-ie-accounting/ui',
  ],
  poweredByHeader: false,
  typedRoutes: true,
  // The floating dev-tools badge covers page content in local use and e2e screenshots.
  devIndicators: false,
};

export default nextConfig;
