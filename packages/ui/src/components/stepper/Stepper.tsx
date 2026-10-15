import { Check } from 'lucide-react';
import { cx } from '../../lib/cx';

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** Id of the current step. Earlier steps show as complete. */
  currentStepId: string;
  /** Accessible name of the list, e.g. "Import progress". */
  label?: string;
  className?: string;
}

/**
 * Progress through a multi-step flow (the import wizard). An ordered list with
 * `aria-current="step"`; each step's state is also spelled out for screen readers.
 * Horizontal from `sm`, vertical below.
 */
export function Stepper({ steps, currentStepId, label = 'Progress', className }: StepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === currentStepId),
  );
  return (
    <ol aria-label={label} className={cx('flex flex-col gap-3 sm:flex-row sm:gap-2', className)}>
      {steps.map((step, index) => {
        const state =
          index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-1 items-start gap-3 sm:flex-col sm:gap-2"
          >
            <div className="flex items-center gap-2 sm:w-full">
              <span
                aria-hidden
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-1 ring-inset',
                  state === 'complete' && 'bg-accent text-accent-fg ring-accent',
                  state === 'current' && 'bg-accent-soft text-accent-soft-fg ring-accent',
                  state === 'upcoming' && 'bg-surface text-fg-muted ring-line-strong/60',
                )}
              >
                {state === 'complete' ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                aria-hidden
                className={cx(
                  'hidden h-px flex-1 sm:block',
                  index === steps.length - 1 && 'sm:hidden',
                  state === 'complete' ? 'bg-accent' : 'bg-line',
                )}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                className={cx(
                  'text-sm font-medium',
                  state === 'upcoming' ? 'text-fg-muted' : 'text-fg',
                )}
              >
                {step.label}
                <span className="sr-only">
                  {state === 'complete'
                    ? ' (completed)'
                    : state === 'current'
                      ? ' (current step)'
                      : ''}
                </span>
              </span>
              {step.description ? (
                <span className="text-xs text-fg-muted">{step.description}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
