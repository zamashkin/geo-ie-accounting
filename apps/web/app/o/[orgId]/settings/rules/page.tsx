import type { Metadata } from 'next';
import { Placeholder } from '../../_shell/Placeholder';

export const metadata: Metadata = { title: 'Rules' };

// Placeholder from WS-04 so the navigation has targets; WS-07 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Rules"
      description="Categorisation rules applied to imported rows."
      owner="WS-07"
    />
  );
}
