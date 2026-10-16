import type { Metadata } from 'next';
import { Placeholder } from '../_shell/Placeholder';

export const metadata: Metadata = { title: 'Transactions' };

// Placeholder from WS-04 so the navigation has targets; WS-06 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Transactions"
      description="Every posting with its GEL equivalent at the NBG rate."
      owner="WS-06"
    />
  );
}
