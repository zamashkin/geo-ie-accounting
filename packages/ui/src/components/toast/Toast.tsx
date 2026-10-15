'use client';

// Toasts on React Aria's toast pattern: a landmark region (F6 reaches it), each toast is
// announced, timers pause while hovered or focused, and focus moves sensibly on close.
// React Aria still marks the API UNSTABLE_; it is wrapped here so a rename stays local.

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { closeButtonClass } from '../dialog/Dialog';

export type ToastTone = 'neutral' | 'positive' | 'negative' | 'warning';

export interface ToastContentValue {
  title: string;
  description?: string;
  tone?: ToastTone;
}

export interface ToastOptions {
  /** Milliseconds. Errors default to staying until dismissed; others to 6 s. Minimum 5 s. */
  timeout?: number;
}

/** One queue per app. Exported for tests and for advanced use (e.g. clearing on sign-out). */
export const toastQueue = new ToastQueue<ToastContentValue>({ maxVisibleToasts: 4 });

/** Shows a toast. Returns its key, which `toastQueue.close(key)` accepts. */
export function toast(content: ToastContentValue, opts: ToastOptions = {}): string {
  const timeout = opts.timeout ?? (content.tone === 'negative' ? undefined : 6000);
  return toastQueue.add(content, timeout === undefined ? {} : { timeout: Math.max(timeout, 5000) });
}

const icons = {
  neutral: Info,
  positive: CheckCircle2,
  negative: XCircle,
  warning: AlertTriangle,
} as const;

const iconColors: Record<ToastTone, string> = {
  neutral: 'text-info',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

export interface ToasterProps {
  queue?: ToastQueue<ToastContentValue>;
}

/** Render once near the root (UiProvider does). */
export function Toaster({ queue = toastQueue }: ToasterProps) {
  return (
    <ToastRegion
      queue={queue}
      aria-label="Notifications"
      className="fixed end-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col-reverse gap-2 outline-none"
    >
      {({ toast: item }) => {
        const tone = item.content.tone ?? 'neutral';
        const Icon = icons[tone];
        return (
          <AriaToast
            toast={item}
            className={cx(
              'flex items-start gap-3 rounded-lg border border-line bg-surface-raised p-3.5 text-fg shadow-lg outline-none',
              'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus',
              'animate-fade-in',
            )}
          >
            <Icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', iconColors[tone])} />
            <ToastContent className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text slot="title" className="text-sm font-semibold">
                {item.content.title}
              </Text>
              {item.content.description ? (
                <Text slot="description" className="text-sm text-fg-muted">
                  {item.content.description}
                </Text>
              ) : null}
            </ToastContent>
            <AriaButton
              slot="close"
              aria-label="Dismiss"
              className={cx(closeButtonClass, '-me-1 -mt-1')}
            >
              <X aria-hidden className="size-4" />
            </AriaButton>
          </AriaToast>
        );
      }}
    </ToastRegion>
  );
}
