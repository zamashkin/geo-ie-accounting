import type { Metadata } from 'next';
import { Placeholder } from '../_shell/Placeholder';

export const metadata: Metadata = { title: 'Clients' };

// Placeholder from WS-04 so the navigation has targets; WS-09 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Clients"
      description="The people and companies you invoice."
      owner="WS-09"
    />
  );
}
