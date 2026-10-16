import type { Metadata } from 'next';
import { Placeholder } from '../_shell/Placeholder';

export const metadata: Metadata = { title: 'Declarations' };

// Placeholder from WS-04 so the navigation has targets; WS-08 replaces this page.
export default function Page() {
  return (
    <Placeholder
      title="Declarations"
      description="Monthly small-business returns, laid out like the rs.ge form."
      owner="WS-08"
    />
  );
}
