'use client';

import {
  Tab as AriaTab,
  TabList as AriaTabList,
  type TabListProps,
  TabPanel as AriaTabPanel,
  type TabPanelProps,
  type TabProps,
  Tabs as AriaTabs,
  type TabsProps,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';

type WithClass<P> = Omit<P, 'className'> & { className?: string | undefined };

/** Tabs (WAI-ARIA tabs pattern): arrow keys move between tabs, Tab moves into the panel. */
export function Tabs({ className, ...props }: WithClass<TabsProps>) {
  return <AriaTabs {...props} className={cx('flex flex-col gap-4', className)} />;
}

export function TabList<T extends object>({ className, ...props }: WithClass<TabListProps<T>>) {
  return (
    <AriaTabList
      {...props}
      className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}
    />
  );
}

export function Tab({ className, ...props }: WithClass<TabProps>) {
  return (
    <AriaTab
      {...props}
      className={cx(
        focusRing,
        'relative -mb-px cursor-default border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors',
        'data-[hovered]:text-fg data-[selected]:border-accent data-[selected]:text-fg data-[disabled]:opacity-50',
        'data-[focus-visible]:-outline-offset-2',
        className,
      )}
    />
  );
}

export function TabPanel({ className, ...props }: WithClass<TabPanelProps>) {
  return <AriaTabPanel {...props} className={cx(focusRing, 'rounded-sm', className)} />;
}
