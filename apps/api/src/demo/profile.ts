// Who and what the public demo is (ADR 0016). Every name, company and account number here is
// made up.

/**
 * The read-only demo login, shown on the sign-in page when `DEMO_MODE=true`. Public on purpose:
 * the API refuses every change it tries.
 */
export const DEMO_LOGIN = {
  email: 'demo@geo-ie-accounting.local',
  password: 'try-the-demo-2026',
  name: 'Demo Visitor',
} as const;

/**
 * Owner of the demo workspaces, who "did" the bookkeeping. The seed gives it a fresh random
 * password on every run and never prints it, so nobody signs in as it.
 */
export const DEMO_AUTHOR = {
  email: 'demo-owner@geo-ie-accounting.local',
  name: 'Nino Example',
} as const;
