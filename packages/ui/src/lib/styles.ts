// Class fragments shared by several components. Plain strings so Tailwind's scanner sees them.

/** Visible focus ring for keyboard focus only (React Aria sets data-focus-visible). */
export const focusRing =
  'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus';

/** The same ring for native elements, which rely on :focus-visible. */
export const focusRingNative =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Box for text-like controls (input, select trigger, date field). */
export const fieldBox =
  'flex min-h-10 w-full items-center rounded-md border border-line-strong bg-surface text-sm text-fg shadow-sm transition-colors ' +
  'data-[hovered]:border-fg-subtle ' +
  'data-[focus-within]:border-accent data-[focus-within]:outline-2 data-[focus-within]:outline-offset-0 data-[focus-within]:outline-focus/40 ' +
  'data-[focused]:border-accent data-[focused]:outline-2 data-[focused]:outline-offset-0 data-[focused]:outline-focus/40 ' +
  'data-[invalid]:border-negative ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-fg-subtle';

/** Popover surface for Select, ComboBox, DatePicker and Menu. */
export const popoverSurface =
  'min-w-(--trigger-width) overflow-auto rounded-md border border-line bg-surface-raised p-1 text-sm text-fg shadow-lg outline-none ' +
  'data-[entering]:animate-fade-in';

/** Options inside a ListBox or Menu. */
export const listItem =
  'relative flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-fg outline-none select-none ' +
  'data-[focused]:bg-accent-soft data-[focused]:text-accent-soft-fg ' +
  'data-[selected]:font-medium ' +
  'data-[disabled]:text-fg-subtle';
