import type { Metadata } from 'next';
import { Placeholder } from '../_shell/Placeholder';

export const metadata: Metadata = { title: 'Imports' };

// Placeholder from WS-04 so the navigation has targets; WS-07 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Imports"
      description="Bank statements you have uploaded and their status."
      owner="WS-07"
    />
  );
}
