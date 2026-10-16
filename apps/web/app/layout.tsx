import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/lib/providers';
import { themeInitScript } from '@/lib/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IE Ledger', template: '%s · IE Ledger' },
  description:
    'Bookkeeping and 1% small-business tax figures for Georgian individual entrepreneurs.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9fafb' },
    { media: '(prefers-color-scheme: dark)', color: '#16181d' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set before hydration by the inline script, hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Static string from theme-script.ts, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
