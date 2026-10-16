'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import type { Key } from 'react-aria-components';
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { fieldBox, focusRing, listItem, popoverSurface } from '../../lib/styles';
import { Description, type FieldChromeProps, FieldError, Label } from '../field/Field';

export interface SelectOption<K extends Key = string> {
  id: K;
  label: string;
  description?: string;
  isDisabled?: boolean;
}

export interface SelectProps<K extends Key = string>
  extends
    Omit<
      AriaSelectProps<SelectOption<K>>,
      'children' | 'className' | 'items' | 'value' | 'onChange' | 'selectionMode'
    >,
    FieldChromeProps {
  options: readonly SelectOption<K>[];
  value?: K | null;
  onChange?: (value: K | null) => void;
  className?: string;
}

/** Single-choice dropdown (listbox pattern). Use ComboBox when the list needs searching. */
export function Select<K extends Key = string>({
  label,
  description,
  errorMessage,
  options,
  value,
  onChange,
  className,
  placeholder,
  ...props
}: SelectProps<K>) {
  return (
    <AriaSelect<SelectOption<K>>
      {...props}
      {...(value !== undefined ? { value } : {})}
      {...(onChange
        ? {
            onChange: (key: Key | null) => {
              onChange(key as K | null);
            },
          }
        : {})}
      placeholder={placeholder ?? 'Select…'}
      className={cx('group flex flex-col gap-1.5', className)}
    >
      {label ? <Label>{label}</Label> : null}
      <AriaButton className={cx(fieldBox, focusRing, 'justify-between gap-2 px-3 py-2 text-start')}>
        {/* The trigger shows the option label only; descriptions belong in the list. A narrow
            trigger truncates the label, so the full text is in a tooltip. */}
        <SelectValue<SelectOption<K>> className="truncate data-[placeholder]:text-fg-subtle">
          {({ selectedText, defaultChildren, isPlaceholder }) =>
            isPlaceholder ? (
              defaultChildren
            ) : (
              <span title={selectedText ?? undefined}>{selectedText}</span>
            )
          }
        </SelectValue>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
      </AriaButton>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover className={cx(popoverSurface, 'max-h-72')}>
        <ListBox items={options} className="outline-none">
          {(option) => (
            <ListBoxItem
              id={option.id}
              textValue={option.label}
              isDisabled={option.isDisabled ?? false}
              className={listItem}
            >
              {({ isSelected }) => (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="truncate text-xs text-fg-muted">{option.description}</span>
                    ) : null}
                  </span>
                  {isSelected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
