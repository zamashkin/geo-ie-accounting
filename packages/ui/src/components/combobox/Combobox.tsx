'use client';

import { Check, ChevronDown } from 'lucide-react';
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  type ComboBoxProps as AriaComboBoxProps,
  Group,
  Input as AriaInput,
  type Key,
  ListBox,
  ListBoxItem,
  Popover,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { fieldBox, focusRing, listItem, popoverSurface } from '../../lib/styles';
import { Description, type FieldChromeProps, FieldError, Label } from '../field/Field';
import type { SelectOption } from '../select/Select';

export interface ComboboxProps<K extends Key = string>
  extends
    Omit<
      AriaComboBoxProps<SelectOption<K>>,
      'children' | 'className' | 'items' | 'defaultItems' | 'value' | 'onChange' | 'selectionMode'
    >,
    FieldChromeProps {
  /** All options; filtered client-side by what the user types (contains, locale-aware). */
  options: readonly SelectOption<K>[];
  value?: K | null;
  onChange?: (value: K | null) => void;
  placeholder?: string;
  /** Text shown when nothing matches. */
  emptyText?: string;
  className?: string;
}

/**
 * Searchable single choice (combobox pattern): type to filter, arrows to move, Enter to pick.
 * For server-side search pass `items` through `options` and drive `inputValue` yourself.
 */
export function Combobox<K extends Key = string>({
  label,
  description,
  errorMessage,
  options,
  value,
  onChange,
  placeholder,
  emptyText = 'No matches',
  className,
  ...props
}: ComboboxProps<K>) {
  return (
    <AriaComboBox<SelectOption<K>>
      {...props}
      {...(value !== undefined ? { value } : {})}
      {...(onChange ? { onChange: (key: Key | null) => onChange(key as K | null) } : {})}
      defaultItems={options}
      className={cx('group flex flex-col gap-1.5', className)}
    >
      {label ? <Label>{label}</Label> : null}
      <Group className={cx(fieldBox, 'pe-1')}>
        <AriaInput
          {...(placeholder ? { placeholder } : {})}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none placeholder:text-fg-subtle"
        />
        <AriaButton
          className={cx(
            focusRing,
            'flex size-8 items-center justify-center rounded-sm text-fg-muted data-[hovered]:bg-surface-muted',
          )}
        >
          <ChevronDown aria-hidden className="size-4" />
        </AriaButton>
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <Popover className={cx(popoverSurface, 'max-h-72')}>
        <ListBox
          className="outline-none"
          renderEmptyState={() => <p className="px-2.5 py-2 text-sm text-fg-muted">{emptyText}</p>}
        >
          {(option: SelectOption<K>) => (
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
    </AriaComboBox>
  );
}
