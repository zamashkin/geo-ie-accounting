'use client';

import { type CalendarDate, parseDate } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  type DatePickerProps as AriaDatePickerProps,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { fieldBox, focusRing } from '../../lib/styles';
import { Description, type FieldChromeProps, FieldError, Label } from '../field/Field';

/** Calendar date as `YYYY-MM-DD`, the same shape as `IsoDate` in contracts. */
export type IsoDateString = string;

function toCalendarDate(value: IsoDateString | null | undefined): CalendarDate | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseDate(value);
}

export interface DatePickerProps
  extends
    Omit<
      AriaDatePickerProps<CalendarDate>,
      'children' | 'className' | 'value' | 'defaultValue' | 'onChange' | 'minValue' | 'maxValue'
    >,
    FieldChromeProps {
  value?: IsoDateString | null;
  defaultValue?: IsoDateString | null;
  onChange?: (value: IsoDateString | null) => void;
  minValue?: IsoDateString;
  maxValue?: IsoDateString;
  className?: string;
}

const iconButton = cx(
  focusRing,
  'flex size-8 items-center justify-center rounded-sm text-fg-muted data-[hovered]:bg-surface-muted data-[hovered]:text-fg',
);

/**
 * Date field with a calendar popover. Keyboard: type or arrow through the segments, or
 * open the calendar with the button. Values cross the boundary as `YYYY-MM-DD` strings so
 * they go straight into contracts (`IsoDate`) without time-zone conversion.
 */
export function DatePicker({
  label,
  description,
  errorMessage,
  value,
  defaultValue,
  onChange,
  minValue,
  maxValue,
  className,
  ...props
}: DatePickerProps) {
  const controlled = useMemo(() => toCalendarDate(value), [value]);
  const initial = useMemo(() => toCalendarDate(defaultValue), [defaultValue]);
  const min = useMemo(() => toCalendarDate(minValue), [minValue]);
  const max = useMemo(() => toCalendarDate(maxValue), [maxValue]);

  return (
    <AriaDatePicker<CalendarDate>
      {...props}
      {...(controlled !== undefined ? { value: controlled } : {})}
      {...(initial !== undefined ? { defaultValue: initial } : {})}
      {...(min ? { minValue: min } : {})}
      {...(max ? { maxValue: max } : {})}
      {...(onChange
        ? {
            onChange: (d: CalendarDate | null) => {
              onChange(d ? d.toString() : null);
            },
          }
        : {})}
      className={cx('group flex flex-col gap-1.5', className)}
    >
      {label ? <Label>{label}</Label> : null}
      <Group className={cx(fieldBox, 'justify-between ps-3 pe-1')}>
        <DateInput className="flex flex-1 py-2 tabular-nums">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-xs px-0.5 caret-transparent outline-none data-[focused]:bg-accent data-[focused]:text-accent-fg data-[placeholder]:text-fg-subtle data-[type=literal]:px-0"
            />
          )}
        </DateInput>
        <AriaButton className={iconButton}>
          <CalendarDays aria-hidden className="size-4" />
        </AriaButton>
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover className="rounded-lg border border-line bg-surface-raised p-3 text-fg shadow-lg outline-none data-[entering]:animate-fade-in">
        <Dialog className="outline-none">
          <Calendar>
            <header className="mb-2 flex items-center justify-between gap-2">
              <AriaButton slot="previous" className={iconButton}>
                <ChevronLeft aria-hidden className="size-4" />
              </AriaButton>
              <Heading className="text-sm font-semibold" />
              <AriaButton slot="next" className={iconButton}>
                <ChevronRight aria-hidden className="size-4" />
              </AriaButton>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              <CalendarGridHeader>
                {(day) => (
                  <CalendarHeaderCell className="pb-1 text-xs font-medium text-fg-muted">
                    {day}
                  </CalendarHeaderCell>
                )}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => (
                  <CalendarCell
                    date={date}
                    className={cx(
                      focusRing,
                      'flex size-9 items-center justify-center rounded-md text-sm tabular-nums',
                      'data-[hovered]:bg-surface-muted data-[outside-month]:hidden',
                      'data-[selected]:bg-accent data-[selected]:text-accent-fg',
                      'data-[unavailable]:text-fg-subtle data-[unavailable]:line-through data-[disabled]:text-fg-subtle',
                      'data-[today]:font-semibold',
                    )}
                  />
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}
