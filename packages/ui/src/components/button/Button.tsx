'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  composeRenderProps,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

const base =
  'inline-flex shrink-0 cursor-default items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors select-none ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-sm data-[hovered]:bg-accent-hover data-[pressed]:bg-accent-hover',
  secondary:
    'border border-line-strong/60 bg-surface text-fg shadow-sm data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
  ghost:
    'text-fg-muted data-[hovered]:bg-surface-muted data-[hovered]:text-fg data-[pressed]:bg-surface-muted',
  danger:
    'bg-negative text-accent-fg shadow-sm data-[hovered]:bg-negative-hover data-[pressed]:bg-negative-hover dark:text-canvas',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  icon: 'size-10',
  'icon-sm': 'size-8',
};

export function buttonClass({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  className?: string | undefined;
} = {}): string {
  return cx(base, focusRing, variants[variant], sizes[size], className);
}

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

/**
 * Button on React Aria: press events that work for mouse, touch and keyboard, and
 * `isPending` that keeps focus, blocks presses and announces progress.
 */
export function Button({ variant, size, className, children, ...props }: ButtonProps) {
  return (
    <AriaButton {...props} className={buttonClass({ variant, size, className })}>
      {composeRenderProps(children, (kids, { isPending }) => (
        <>
          {isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {kids}
        </>
      ))}
    </AriaButton>
  );
}

export interface ButtonLinkProps extends Omit<AriaLinkProps, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

/** A link that looks like a button. Navigates through the app router (see UiProvider). */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <AriaLink {...props} className={buttonClass({ variant, size, className })} />;
}
