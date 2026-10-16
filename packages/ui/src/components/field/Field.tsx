'use client';

import type { ReactNode } from 'react';
import {
  FieldError as AriaFieldError,
  type FieldErrorProps,
  Input as AriaInput,
  type InputProps,
  Label as AriaLabel,
  type LabelProps,
  Text,
  type TextProps,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { fieldBox } from '../../lib/styles';

export function Label({ className, ...props }: LabelProps) {
  return (
    <AriaLabel {...props} className={cx('text-sm font-medium text-fg select-none', className)} />
  );
}

export function Description({ className, ...props }: Omit<TextProps, 'slot'>) {
  return <Text {...props} slot="description" className={cx('text-xs text-fg-muted', className)} />;
}

export function FieldError({
  className,
  ...props
}: Omit<FieldErrorProps, 'className'> & { className?: string | undefined }) {
  return (
    <AriaFieldError {...props} className={cx('text-xs font-medium text-negative-fg', className)} />
  );
}

/** Bare text input with the field box styles. Use inside a React Aria field, or alone with aria-label. */
export function Input({
  className,
  ...props
}: Omit<InputProps, 'className'> & { className?: string | undefined }) {
  return (
    <AriaInput
      {...props}
      className={cx(fieldBox, 'px-3 py-2 outline-none placeholder:text-fg-subtle', className)}
    />
  );
}

export interface FieldChromeProps {
  label?: ReactNode;
  description?: ReactNode;
  /** Shown when the field is invalid. A string, or a function of the validation result. */
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, 'className' | 'children'>, FieldChromeProps {
  className?: string;
  placeholder?: string;
  inputClassName?: string;
}

/** Labelled text input with description and error, wired with ARIA by React Aria. */
export function TextField({
  label,
  description,
  errorMessage,
  className,
  placeholder,
  inputClassName,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField {...props} className={cx('flex flex-col gap-1.5', className)}>
      {label ? <Label>{label}</Label> : null}
      <Input {...(placeholder ? { placeholder } : {})} className={inputClassName} />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  );
}
