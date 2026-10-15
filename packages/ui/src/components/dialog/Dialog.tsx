'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { focusRing } from '../../lib/styles';

export { DialogTrigger };

type DialogChildren = ReactNode | ((opts: { close: () => void }) => ReactNode);

export interface DialogProps extends Omit<
  ModalOverlayProps,
  'children' | 'className' | 'isDismissable'
> {
  title: ReactNode;
  description?: ReactNode;
  children?: DialogChildren;
  /** `alertdialog` for confirmations that interrupt (no dismiss on outside click). */
  role?: 'dialog' | 'alertdialog';
  size?: 'sm' | 'md' | 'lg';
  /** Hide the corner close button (alert dialogs offer explicit actions instead). */
  hideCloseButton?: boolean;
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export const closeButtonClass = cx(
  focusRing,
  'flex size-8 items-center justify-center rounded-md text-fg-muted data-[hovered]:bg-surface-muted data-[hovered]:text-fg',
);

/**
 * Modal dialog: focus is trapped and restored, Escape closes, the page behind is inert.
 * Put it inside a `DialogTrigger` next to its trigger button, or control it with `isOpen`.
 */
export function Dialog({
  title,
  description,
  children,
  role = 'dialog',
  size = 'md',
  hideCloseButton = role === 'alertdialog',
  ...overlayProps
}: DialogProps) {
  return (
    <ModalOverlay
      {...overlayProps}
      isDismissable={role !== 'alertdialog'}
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-0 data-[entering]:animate-fade-in sm:items-center sm:p-4"
    >
      <Modal
        className={cx(
          'max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-lg border border-line bg-surface-raised shadow-lg outline-none data-[entering]:animate-zoom-in sm:rounded-lg',
          widths[size],
        )}
      >
        <AriaDialog role={role} className="relative flex flex-col gap-4 p-5 outline-none sm:p-6">
          {({ close }) => (
            <>
              <div className="flex flex-col gap-1.5 pe-8">
                <Heading slot="title" className="text-lg font-semibold text-fg">
                  {title}
                </Heading>
                {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
              </div>
              {hideCloseButton ? null : (
                <AriaButton
                  slot="close"
                  aria-label="Close"
                  className={cx(closeButtonClass, 'absolute end-3 top-3')}
                >
                  <X aria-hidden className="size-4" />
                </AriaButton>
              )}
              {typeof children === 'function' ? children({ close }) : children}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** Right-aligned action row at the bottom of a dialog. Stacks on narrow screens. */
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}
