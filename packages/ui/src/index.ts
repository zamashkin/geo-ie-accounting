// packages/ui: design-system components. WS-04 builds the kit (tokens, Storybook, components).

/** Joins class names, skipping falsy values. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
