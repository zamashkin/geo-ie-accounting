'use client';

import { AlertCircle, MailCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { isApiError } from '@/lib/api/errors';

/** Form-level message, announced when it appears. */
export function FormAlert({ tone = 'error', children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : MailCheck;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'flex gap-2 rounded-md border border-negative/30 bg-negative-soft p-3 text-sm text-negative-fg'
          : 'flex gap-2 rounded-md border border-positive/30 bg-positive-soft p-3 text-sm text-positive-fg'
      }
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/**
 * Routes an API error into the form: field errors onto their fields, anything else into the
 * returned form-level message.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!isApiError(err)) return 'Something went wrong. Try again.';
  const fieldErrors = err.fieldErrors();
  let unmatched = false;
  for (const [path, message] of Object.entries(fieldErrors)) {
    if ((fields as readonly string[]).includes(path)) setError(path as Path<T>, { message });
    else unmatched = true;
  }
  if (Object.keys(fieldErrors).length > 0 && !unmatched) return null;
  if (err.kind === 'network') return 'Could not reach the server. Check your connection and try again.';
  return err.problem.detail ?? err.problem.title;
}
