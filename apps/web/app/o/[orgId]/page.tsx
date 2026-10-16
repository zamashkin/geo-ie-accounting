import type { Metadata } from 'next';
import { Placeholder } from './_shell/Placeholder';

export const metadata: Metadata = { title: 'Dashboard' };

// Placeholder from WS-04 so the navigation has targets; WS-08 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Dashboard"
      description="Income this month, year-to-date turnover against the limit, and the next filing deadline."
      owner="WS-08"
    />
  );
}
