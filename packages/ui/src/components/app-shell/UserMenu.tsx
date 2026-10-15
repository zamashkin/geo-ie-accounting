'use client';

import { LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button as AriaButton, Header, type Key } from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '../menu/Menu';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserMenuProps {
  user: { name: string; email: string };
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onSignOut: () => void;
  /** Link to the account page, if there is one. */
  accountHref?: string;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

const THEMES: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'System theme', icon: <Monitor /> },
  { id: 'light', label: 'Light', icon: <Sun /> },
  { id: 'dark', label: 'Dark', icon: <Moon /> },
];

/** Avatar button with account details, theme choice and sign out. */
export function UserMenu({ user, theme, onThemeChange, onSignOut, accountHref }: UserMenuProps) {
  return (
    <MenuTrigger>
      <AriaButton
        className={cx(
          focusRing,
          'flex size-9 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg ring-1 ring-line data-[hovered]:ring-line-strong',
        )}
      >
        <span aria-hidden>{initials(user.name)}</span>
        <span className="sr-only">Account menu for {user.name}</span>
      </AriaButton>
      <Menu
        aria-label="Account"
        placement="bottom end"
        popoverClassName="min-w-60"
        onAction={(key: Key) => {
          if (key === 'sign-out') onSignOut();
        }}
      >
        <MenuSection aria-label="Signed in as">
          <Header className="flex flex-col px-2.5 py-2">
            <span className="truncate text-sm font-medium text-fg">{user.name}</span>
            <span className="truncate text-xs text-fg-muted">{user.email}</span>
          </Header>
          {accountHref ? (
            <MenuItem id="account" href={accountHref} icon={<UserRound />}>
              Account
            </MenuItem>
          ) : null}
        </MenuSection>
        <MenuSeparator />
        <MenuSection
          title="Theme"
          selectionMode="single"
          selectedKeys={[theme]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return;
            const [next] = [...keys];
            if (next === 'system' || next === 'light' || next === 'dark') onThemeChange(next);
          }}
        >
          {THEMES.map((t) => (
            <MenuItem key={t.id} id={t.id} icon={t.icon}>
              {t.label}
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuItem id="sign-out" icon={<LogOut />}>
          Sign out
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
