'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { closeButtonClass } from '../dialog/Dialog';

export interface SheetProps extends Omit<ModalOverlayProps, 'children' | 'className'> {
  title: ReactNode;
  /** Visually hide the title (it still names the dialog for screen readers). */
  hideTitle?: boolean;
  description?: ReactNode;
  side?: 'left' | 'right';
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  className?: string;
}

/**
 * Panel that slides in from the edge: mobile navigation, row details, filters.
 * Same focus and dismissal behaviour as Dialog.
 */
export function Sheet({
  title,
  hideTitle = false,
  description,
  side = 'right',
  children,
  className,
  isDismissable = true,
  ...overlayProps
}: SheetProps) {
  return (
    <ModalOverlay
      {...overlayProps}
      isDismissable={isDismissable}
      className="fixed inset-0 z-50 bg-overlay data-[entering]:animate-fade-in"
    >
      <Modal
        className={cx(
          'fixed inset-y-0 flex w-[min(22rem,calc(100vw-3rem))] flex-col border-line bg-surface-raised shadow-lg outline-none',
          side === 'left'
            ? 'start-0 border-e data-[entering]:animate-slide-in-left'
            : 'end-0 border-s data-[entering]:animate-slide-in-right',
          className,
        )}
      >
        <AriaDialog className="flex h-full min-h-0 flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
                <div className={cx('flex flex-col gap-1', hideTitle && 'sr-only')}>
                  <Heading slot="title" className="text-base font-semibold text-fg">
                    {title}
                  </Heading>
                  {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
                </div>
                <AriaButton
                  slot="close"
                  aria-label="Close"
                  className={cx(closeButtonClass, 'ms-auto')}
                >
                  <X aria-hidden className="size-4" />
                </AriaButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {typeof children === 'function' ? children({ close }) : children}
              </div>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
