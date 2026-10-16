import type { Metadata } from 'next';
import { Placeholder } from '../../_shell/Placeholder';

export const metadata: Metadata = { title: 'Members' };

// Placeholder from WS-04 so the navigation has targets; WS-10 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Members"
      description="People with access to this workspace and their roles."
      owner="WS-10"
    />
  );
}
