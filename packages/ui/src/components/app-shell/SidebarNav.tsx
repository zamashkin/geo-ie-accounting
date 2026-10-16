'use client';

import { type ReactNode, useId } from 'react';
import { Link } from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';
import { useShell } from './AppShell';

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  /** `exact`: only this path. `prefix` (default): this path and anything under it. */
  match?: 'exact' | 'prefix';
  /** Small trailing marker, e.g. a count badge. */
  badge?: ReactNode;
}

export interface NavSection {
  /** Section heading, e.g. "Settings". Omit for the first, unlabelled group. */
  label?: string;
  items: readonly NavItem[];
}

export interface SidebarNavProps {
  sections: readonly NavSection[];
  /** Current pathname, used to mark the active item with aria-current="page". */
  currentPath: string;
  /** Accessible name of the nav landmark. */
  label?: string;
}

export function isNavItemActive(item: Pick<NavItem, 'href' | 'match'>, path: string): boolean {
  const clean = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  const href = clean(item.href);
  const current = clean(path);
  if (item.match === 'exact') return current === href;
  return current === href || current.startsWith(`${href}/`);
}

/** Main navigation. Items are links; the current one is marked for assistive tech. */
export function SidebarNav({ sections, currentPath, label = 'Main' }: SidebarNavProps) {
  const { closeMobileNav } = useShell();
  // The nav renders twice (desktop sidebar, mobile sheet), so ids must be unique per instance.
  const idPrefix = useId();
  return (
    <nav aria-label={label} className="flex flex-col gap-5">
      {sections.map((section, i) => {
        const headingId = section.label ? `${idPrefix}-section-${i}` : undefined;
        return (
          <div key={section.label ?? i} className="flex flex-col gap-0.5">
            {section.label ? (
              <h2
                id={headingId}
                className="px-2.5 pb-1 text-xs font-medium tracking-wide text-fg-muted"
              >
                {section.label}
              </h2>
            ) : null}
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = isNavItemActive(item, currentPath);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      {...(active ? { 'aria-current': 'page' as const } : {})}
                      onPress={closeMobileNav}
                      className={cx(
                        focusRing,
                        'group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                        active
                          ? 'bg-accent-soft text-accent-soft-fg'
                          : 'text-fg-muted data-[hovered]:bg-surface-muted data-[hovered]:text-fg',
                      )}
                    >
                      {item.icon ? (
                        <span
                          aria-hidden
                          className={cx(active ? 'text-accent-soft-fg' : 'text-fg-subtle')}
                        >
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
