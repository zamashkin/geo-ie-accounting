import type { ReactNode } from 'react';
import { BrandMark } from './_components/BrandMark';

/** Centered card on a quiet background for sign-in, sign-up and invitations. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        {children}
      </main>
      <footer className="mt-10 max-w-sm text-center text-xs text-fg-muted">
        Figures for the monthly small-business return on rs.ge. IE Ledger never files anything for
        you.
      </footer>
    </div>
  );
}
