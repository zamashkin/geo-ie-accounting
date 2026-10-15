'use client';

import { useState } from 'react';
import {
  Group,
  Input as AriaInput,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { fieldBox } from '../../lib/styles';
import {
  formatMoney,
  minorUnitExponent,
  type ParseMoneyResult,
  parseMoneyInput,
  toMinor,
} from '../../money/format';
import { Description, type FieldChromeProps, FieldError, Label } from '../field/Field';

export interface MoneyInputProps
  extends
    Omit<
      AriaTextFieldProps,
      'value' | 'defaultValue' | 'onChange' | 'className' | 'children' | 'type' | 'inputMode'
    >,
    FieldChromeProps {
  /** Minor units as the wire string (`"125050"` = 1,250.50), or null when empty. */
  value?: string | null;
  /**
   * Called with minor units as a string whenever the text parses (or null when cleared).
   * Not called while the text is invalid; the field shows why instead.
   */
  onChange?: (amountMinor: string | null) => void;
  currency: string;
  allowNegative?: boolean;
  placeholder?: string;
  className?: string;
}

const REASONS: Record<Exclude<ParseMoneyResult, { ok: true }>['reason'], (cur: string) => string> =
  {
    empty: () => 'Enter an amount',
    invalid: () => 'Use digits and a dot for decimals, e.g. 1250.50',
    too_many_decimals: (cur) => {
      const exp = minorUnitExponent(cur);
      return exp === 0 ? `${cur} has no decimals` : `${cur} allows ${exp} decimal places`;
    },
    negative: () => 'The amount cannot be negative',
  };

function display(minor: string | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || minor === '') return '';
  return formatMoney(toMinor(minor), currency, { currencyDisplay: 'none' });
}

/**
 * Money input that never goes through a float: the text is parsed digit by digit into
 * minor units (bigint) and handed back as the wire string. Grouping is applied on blur.
 */
export function MoneyInput({
  label,
  description,
  errorMessage,
  value,
  onChange,
  currency,
  allowNegative = false,
  placeholder,
  className,
  onBlur,
  isInvalid,
  ...props
}: MoneyInputProps) {
  const [text, setText] = useState(() => display(value, currency));
  const [syncedValue, setSyncedValue] = useState(value);
  const [parseError, setParseError] = useState<string | null>(null);

  // Adopt a new value from the parent (form reset, programmatic change) during render.
  if (value !== syncedValue) {
    setSyncedValue(value);
    const current = parseMoneyInput(text, currency, { allowNegative });
    const sameAmount =
      current.ok && value !== null && value !== undefined && current.amountMinor === toMinor(value);
    if (!sameAmount) {
      setText(display(value, currency));
      setParseError(null);
    }
  }

  function handleChange(next: string) {
    setText(next);
    const result = parseMoneyInput(next, currency, { allowNegative });
    if (result.ok) {
      setParseError(null);
      const minor = result.amountMinor.toString();
      setSyncedValue(minor);
      onChange?.(minor);
    } else if (result.reason === 'empty') {
      setParseError(null);
      setSyncedValue(null);
      onChange?.(null);
    } else {
      setParseError(REASONS[result.reason](currency));
    }
  }

  const invalid = isInvalid === true || parseError !== null;

  return (
    <AriaTextField
      {...props}
      value={text}
      onChange={handleChange}
      onBlur={(e) => {
        const result = parseMoneyInput(text, currency, { allowNegative });
        if (result.ok) setText(display(result.amountMinor.toString(), currency));
        onBlur?.(e);
      }}
      isInvalid={invalid}
      inputMode="decimal"
      className={cx('flex flex-col gap-1.5', className)}
    >
      {label ? (
        <Label>
          {label}
          <span className="sr-only"> ({currency})</span>
        </Label>
      ) : null}
      <Group className={cx(fieldBox, 'overflow-hidden')} isInvalid={invalid}>
        <AriaInput
          placeholder={placeholder ?? '0.00'}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-end tabular-nums outline-none placeholder:text-fg-subtle"
        />
        <span
          aria-hidden
          className="flex h-full items-center border-s border-line bg-surface-muted px-3 text-xs font-medium text-fg-muted"
        >
          {currency}
        </span>
      </Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{parseError ?? errorMessage}</FieldError>
    </AriaTextField>
  );
}
