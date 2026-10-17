import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowLeftRight,
  FileText,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { Button } from '../button/Button';
import { EmptyState } from '../empty-state/EmptyState';
import { AppShell, PageContainer, PageHeader } from './AppShell';
import { OrgSwitcher } from './OrgSwitcher';
import { SidebarNav, type NavSection } from './SidebarNav';
import { type ThemePreference, UserMenu } from './UserMenu';

const ORG = '0199f2a0-0000-7000-8000-000000000001';
const base = `/o/${ORG}`;

const SECTIONS: NavSection[] = [
  {
    items: [
      { href: base, label: 'Dashboard', icon: <LayoutDashboard />, match: 'exact' },
      { href: `${base}/transactions`, label: 'Transactions', icon: <ArrowLeftRight /> },
      { href: `${base}/imports`, label: 'Imports', icon: <Upload /> },
      { href: `${base}/declarations`, label: 'Declarations', icon: <FileText /> },
      { href: `${base}/invoices`, label: 'Invoices', icon: <ReceiptText /> },
      { href: `${base}/clients`, label: 'Clients', icon: <Users /> },
    ],
  },
  {
    label: 'Workspace',
    items: [{ href: `${base}/settings`, label: 'Settings', icon: <Settings /> }],
  },
];

const onSignOut = fn();

function Shell() {
  const [theme, setTheme] = useState<ThemePreference>('system');
  return (
    <AppShell
      brand={
        <span className="text-base font-semibold tracking-tight text-fg">geo-ie-accounting</span>
      }
      orgSwitcher={
        <OrgSwitcher
          orgs={[
            { id: ORG, name: 'Nino Beridze IE', role: 'owner' },
            {
              id: '0199f2a0-0000-7000-8000-000000000002',
              name: 'Giorgi Kapanadze IE',
              role: 'accountant',
            },
          ]}
          currentOrgId={ORG}
          getOrgHref={(id) => `/o/${id}`}
        />
      }
      nav={<SidebarNav sections={SECTIONS} currentPath={`${base}/transactions`} />}
      userMenu={
        <UserMenu
          user={{ name: 'Nino Beridze', email: 'nino@example.ge' }}
          theme={theme}
          onThemeChange={setTheme}
          onSignOut={onSignOut}
        />
      }
    >
      <PageContainer>
        <PageHeader
          title="Transactions"
          description="Every posting with its GEL equivalent at the NBG rate."
          actions={<Button>New transaction</Button>}
        />
        <EmptyState title="No transactions yet" description="Import a statement to get started." />
      </PageContainer>
    </AppShell>
  );
}

const meta = {
  title: 'App/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  render: () => <Shell />,
  args: { brand: null, nav: null, children: null },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvas, userEvent }) => {
    const nav = canvas.getAllByRole('navigation', { name: 'Main' })[0];
    if (!nav) throw new Error('nav missing');
    await expect(canvas.getAllByRole('link', { name: 'Transactions' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(canvas.getByRole('main')).toBeInTheDocument();

    // User menu: theme selection and sign out.
    await userEvent.click(canvas.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    await userEvent.click(canvas.getByRole('button', { name: /account menu/i }));
    await expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await expect(onSignOut).toHaveBeenCalled();
  },
};

export const OrgSwitching: Story = {
  play: async ({ canvas, userEvent }) => {
    const switcher = canvas.getAllByRole('button', {
      name: /nino beridze ie.*switch workspace/i,
    })[0];
    if (!switcher) throw new Error('switcher missing');
    await userEvent.click(switcher);
    // MenuTrigger labels the menu by its trigger button.
    const menu = await screen.findByRole('menu', { name: /nino beridze ie/i });
    await expect(menu).toHaveTextContent('Giorgi Kapanadze IE');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

/** 360px wide: sidebar collapses into a sheet behind the menu button. */
export const Mobile360: Story = {
  // The vitest addon resizes the test iframe to the story's viewport global.
  globals: { viewport: { value: 'mobile360', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(window.innerWidth).toBe(360);
    const open = canvas.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(open);
    const sheet = await screen.findByRole('dialog', { name: 'Navigation' });
    await expect(sheet).toHaveTextContent('Declarations');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const DarkTheme: Story = { globals: { theme: 'dark' } };
