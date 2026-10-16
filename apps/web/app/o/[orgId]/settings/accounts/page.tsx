import type { Metadata } from 'next';
import { Placeholder } from '../../_shell/Placeholder';

export const metadata: Metadata = { title: 'Accounts' };

// Placeholder from WS-04 so the navigation has targets; WS-06 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Accounts"
      description="Bank accounts and the chart of accounts."
      owner="WS-06"
    />
  );
}
