import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { AppProviders } from '@/lib/providers';
import { themeInitScript } from '@/lib/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'geo-ie-accounting', template: '%s · geo-ie-accounting' },
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
      <body className="min-h-dvh bg-canvas text-fg antialiased">
        {/* Applies the stored theme before first paint (static string, no user input). */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
