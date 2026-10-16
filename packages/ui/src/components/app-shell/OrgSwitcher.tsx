'use client';

import { Building2, ChevronsUpDown, Plus } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '../menu/Menu';
import { useShell } from './AppShell';

export interface OrgSummary {
  id: string;
  name: string;
  /** The viewer's role in this workspace, shown as a hint. */
  role?: string;
}

export interface OrgSwitcherProps {
  orgs: readonly OrgSummary[];
  currentOrgId: string;
  /** Where each workspace lives, e.g. `(id) => '/o/' + id`. */
  getOrgHref: (orgId: string) => string;
  /** Link to create a new workspace; omitted = no "New workspace" item. */
  createHref?: string;
}

export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]?.[0], words[1]?.[0]] : [name.trim().slice(0, 2)];
  return letters.join('').toUpperCase() || '?';
}

function OrgAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-fg',
        className,
      )}
    >
      {orgInitials(name)}
    </span>
  );
}

/**
 * Switches workspace (organisation). Accountants have many; owners usually one. A menu of
 * links, so each workspace is a real URL and opens in a new tab with a modifier click.
 */
export function OrgSwitcher({ orgs, currentOrgId, getOrgHref, createHref }: OrgSwitcherProps) {
  const { closeMobileNav } = useShell();
  const current = orgs.find((o) => o.id === currentOrgId);
  const name = current?.name ?? 'Choose workspace';

  return (
    <MenuTrigger>
      <AriaButton
        className={cx(
          focusRing,
          'flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2 py-1.5 text-start data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
        )}
      >
        {current ? (
          <OrgAvatar name={current.name} />
        ) : (
          <Building2 aria-hidden className="size-5 text-fg-muted" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg">{name}</span>
          {current?.role ? (
            <span className="truncate text-xs text-fg-muted capitalize">{current.role}</span>
          ) : null}
        </span>
        <span className="sr-only">, switch workspace</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
      </AriaButton>
      <Menu
        aria-label="Workspaces"
        placement="bottom start"
        popoverClassName="w-(--trigger-width) min-w-60"
        selectionMode="single"
        selectedKeys={[currentOrgId]}
        onAction={closeMobileNav}
      >
        <MenuSection title="Workspaces">
          {orgs.map((org) => (
            <MenuItem
              key={org.id}
              id={org.id}
              href={getOrgHref(org.id)}
              textValue={org.name}
              icon={<OrgAvatar name={org.name} className="size-6 text-[0.625rem]" />}
              hint={org.role ? <span className="capitalize">{org.role}</span> : undefined}
            >
              {org.name}
            </MenuItem>
          ))}
        </MenuSection>
        {createHref ? (
          <>
            <MenuSeparator />
            <MenuItem id="__create" href={createHref} icon={<Plus />}>
              New workspace
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </MenuTrigger>
  );
}
