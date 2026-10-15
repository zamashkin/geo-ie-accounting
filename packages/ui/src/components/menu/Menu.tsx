'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Header,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  MenuSection as AriaMenuSection,
  type MenuSectionProps,
  MenuTrigger,
  Popover,
  type PopoverProps,
  Separator,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { listItem, popoverSurface } from '../../lib/styles';

export { MenuTrigger };

export interface MenuProps<T> extends Omit<AriaMenuProps<T>, 'className'> {
  placement?: PopoverProps['placement'];
  popoverClassName?: string;
}

/** Menu of actions (menu button pattern) in a popover. Place inside MenuTrigger. */
export function Menu<T extends object>({
  placement = 'bottom start',
  popoverClassName,
  ...props
}: MenuProps<T>) {
  return (
    <Popover placement={placement} className={cx(popoverSurface, 'min-w-48', popoverClassName)}>
      <AriaMenu {...props} className="max-h-[inherit] overflow-auto outline-none" />
    </Popover>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'className' | 'children'> {
  children: ReactNode;
  icon?: ReactNode;
  /** Trailing hint, e.g. a role or a shortcut. */
  hint?: ReactNode;
  tone?: 'default' | 'danger';
}

export function MenuItem({
  children,
  icon,
  hint,
  tone = 'default',
  textValue,
  ...props
}: MenuItemProps) {
  return (
    <AriaMenuItem
      {...props}
      {...(textValue !== undefined
        ? { textValue }
        : typeof children === 'string'
          ? { textValue: children }
          : {})}
      className={cx(
        listItem,
        'pe-7 [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'danger' &&
          'text-negative-fg data-[focused]:bg-negative-soft data-[focused]:text-negative-fg',
      )}
    >
      {({ isSelected, selectionMode }) => (
        <>
          {icon ? (
            <span aria-hidden className="text-fg-muted">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
          {selectionMode !== 'none' && isSelected ? (
            <Check aria-hidden className="absolute end-2" />
          ) : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSection<T extends object>({
  title,
  className,
  children,
  ...props
}: Omit<MenuSectionProps<T>, 'className' | 'children'> & {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AriaMenuSection {...props} className={cx('flex flex-col', className)}>
      {title ? (
        <Header className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-muted">{title}</Header>
      ) : null}
      {children}
    </AriaMenuSection>
  );
}

export function MenuSeparator() {
  return <Separator className="mx-1 my-1 border-t border-line" />;
}
