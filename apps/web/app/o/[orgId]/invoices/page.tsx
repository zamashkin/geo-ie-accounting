import type { Metadata } from 'next';
import { Placeholder } from '../_shell/Placeholder';

export const metadata: Metadata = { title: 'Invoices' };

// Placeholder from WS-04 so the navigation has targets; WS-09 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Invoices"
      description="Invoices to your clients and their payment status."
      owner="WS-09"
    />
  );
}
