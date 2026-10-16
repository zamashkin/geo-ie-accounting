'use client';

import type { MeResponse } from '@ie-ledger/contracts';
import { AppShell, type NavSection, OrgSwitcher, SidebarNav, toast, UserMenu } from '@ie-ledger/ui';
import {
  ArrowLeftRight,
  Banknote,
  FileText,
  History,
  LayoutDashboard,
  ListFilter,
  ReceiptText,
  Upload,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { errorMessage } from '@/lib/api/api-error';
import { ORG_NAV, ORG_SETTINGS_NAV, type OrgNavKey, orgHref } from '@/lib/nav';
import { useThemePreference } from '@/lib/theme';

const ICONS: Record<OrgNavKey, ReactNode> = {
  dashboard: <LayoutDashboard />,
  transactions: <ArrowLeftRight />,
  imports: <Upload />,
  declarations: <FileText />,
  invoices: <ReceiptText />,
  clients: <Users />,
  accounts: <Wallet />,
  rules: <ListFilter />,
  members: <UserCog />,
  audit: <History />,
};

function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 rounded-md text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 3.5h9.5L16 6v10.5H4z" strokeLinejoin="round" />
          <path d="M7 8.5h6M7 11.5h6M7 14.5h3.5" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight">IE Ledger</span>
    </Link>
  );
}

export function OrgShell({
  orgId,
  session,
  children,
}: {
  orgId: string;
  session: MeResponse;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useThemePreference();

  const sections = useMemo<NavSection[]>(
    () => [
      {
        items: ORG_NAV.map((item) => ({
          href: orgHref(orgId, item.path),
          label: item.label,
          icon: ICONS[item.key],
          match: item.match,
        })),
      },
      {
        label: 'Settings',
        items: ORG_SETTINGS_NAV.map((item) => ({
          href: orgHref(orgId, item.path),
          label: item.label,
          icon: ICONS[item.key],
          match: item.match,
        })),
      },
    ],
    [orgId],
  );

  async function signOut() {
    try {
      // Loaded on demand: keeps the auth client and its schemas out of the shell bundle.
      const { authClient } = await import('@/lib/auth/client');
      await authClient().signOut();
      router.replace('/sign-in');
      router.refresh();
    } catch (err) {
      toast({ title: 'Sign out failed', description: errorMessage(err), tone: 'negative' });
    }
  }

  return (
    <AppShell
      brand={<Brand />}
      orgSwitcher={
        <OrgSwitcher
          orgs={session.memberships.map((m) => ({ id: m.orgId, name: m.orgName, role: m.role }))}
          currentOrgId={orgId}
          getOrgHref={(id) => orgHref(id)}
        />
      }
      nav={<SidebarNav sections={sections} currentPath={pathname} />}
      sidebarFooter={
        <Link
          href="/rates"
          className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-fg-muted outline-none hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Banknote aria-hidden className="size-4 text-fg-subtle" />
          NBG rates
        </Link>
      }
      userMenu={
        <UserMenu
          user={session.user}
          theme={theme}
          onThemeChange={setTheme}
          onSignOut={() => void signOut()}
        />
      }
    >
      {children}
    </AppShell>
  );
}
