'use client';

import { Menu as MenuIcon } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';
import { Sheet } from '../sheet/Sheet';

interface ShellContextValue {
  /** Closes the mobile navigation sheet (no-op on desktop). */
  closeMobileNav: () => void;
}

const ShellContext = createContext<ShellContextValue>({ closeMobileNav: () => undefined });

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

export interface AppShellProps {
  /** Product mark, top of the sidebar and the mobile top bar. */
  brand: ReactNode;
  /** Workspace switcher, under the brand. */
  orgSwitcher?: ReactNode;
  /** Main navigation (SidebarNav). */
  nav: ReactNode;
  /** Pinned to the bottom of the sidebar, e.g. a help link. */
  sidebarFooter?: ReactNode;
  /** Right side of the top bar (UserMenu). */
  userMenu?: ReactNode;
  /** Left side of the top bar on desktop, e.g. breadcrumbs. */
  topbarStart?: ReactNode;
  children: ReactNode;
  /** Id of the main element, target of the skip link. */
  mainId?: string;
}

/**
 * Application frame: a skip link, a fixed sidebar from `lg`, and on smaller screens a top
 * bar whose menu button opens the same navigation in a sheet. Works down to 360px.
 */
export function AppShell({
  brand,
  orgSwitcher,
  nav,
  sidebarFooter,
  userMenu,
  topbarStart,
  children,
  mainId = 'main',
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const ctx: ShellContextValue = { closeMobileNav: () => setMobileNavOpen(false) };

  const sidebarBody = (
    <div className="flex h-full flex-col gap-4">
      {orgSwitcher ? <div>{orgSwitcher}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
      {sidebarFooter ? <div className="border-t border-line pt-3">{sidebarFooter}</div> : null}
    </div>
  );

  return (
    <ShellContext.Provider value={ctx}>
      <a
        href={`#${mainId}`}
        className="fixed start-3 top-3 z-[70] -translate-y-20 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-md transition-transform focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Skip to content
      </a>
      <div className="min-h-dvh bg-canvas lg:ps-sidebar">
        {/* Desktop sidebar */}
        <aside
          aria-label="Sidebar"
          className="fixed inset-y-0 start-0 z-30 hidden w-sidebar flex-col border-e border-line bg-surface px-3 py-4 lg:flex"
        >
          <div className="mb-4 px-2">{brand}</div>
          {sidebarBody}
        </aside>

        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-topbar items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-sm sm:px-4 lg:px-6">
          <AriaButton
            aria-label="Open navigation"
            onPress={() => setMobileNavOpen(true)}
            className={cx(
              focusRing,
              'flex size-10 items-center justify-center rounded-md text-fg-muted data-[hovered]:bg-surface-muted data-[hovered]:text-fg lg:hidden',
            )}
          >
            <MenuIcon aria-hidden className="size-5" />
          </AriaButton>
          <div className="min-w-0 lg:hidden">{brand}</div>
          <div className="hidden min-w-0 flex-1 lg:block">{topbarStart}</div>
          <div className="ms-auto flex items-center gap-2">{userMenu}</div>
        </header>

        <main id={mainId} tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>

      <Sheet
        side="left"
        title="Navigation"
        hideTitle
        isOpen={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        className="lg:hidden"
      >
        <div className="flex h-full flex-col gap-4">
          <div className="px-2">{brand}</div>
          {sidebarBody}
        </div>
      </Sheet>
    </ShellContext.Provider>
  );
}

/** Standard page padding and max width inside the shell. */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}>
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Page title row: h1, optional description, actions that wrap under the title on mobile. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
