import type { Metadata } from 'next';
import { Placeholder } from '../../_shell/Placeholder';

export const metadata: Metadata = { title: 'Audit log' };

// Placeholder from WS-04 so the navigation has targets; WS-10 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Audit log"
      description="Every change made in this workspace."
      owner="WS-10"
    />
  );
}
