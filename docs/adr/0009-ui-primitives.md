# 0009 React Aria Components for UI primitives

Status: accepted (WS-04, 2026-10-16)

## Context
`packages/ui` needs accessible primitives for WCAG 2.2 AA on core flows (SPEC §4): select, combobox, date picker, dialog, sheet, menu, tabs, toast and a file drop target, all keyboard-complete. Writing these from scratch is where accessibility bugs come from. The kit also has to look like this product, so a styled library is out.

## Decision
Use React Aria Components 1.22.1 (Adobe, unstyled, Apache-2.0) with `@internationalized/date` 3.12.4, styled with Tailwind 4 through the tokens in `packages/ui/src/styles`.

Other pinned pieces:

| Concern | Choice |
|---|---|
| Tables | TanStack Table 9.3.1 + TanStack Virtual 3.14.19. Server-side sort and filter (`manual*`), cursor pagination through `onLoadMore`. Fixed row height, no measuring. |
| Icons | lucide-react 1.56.0 |
| Storybook | 10.6.2 (`@storybook/react-vite`, Vite 8.3.4), in `packages/ui/.storybook` |
| Story tests | `@storybook/addon-vitest` (Vitest 5.0.5 browser mode, Playwright 1.64.1 Chromium). Every story is a test: it renders, runs its play function and runs axe through `@storybook/addon-a11y` with `a11y.test = 'error'`. |
| a11y lint | `eslint-plugin-jsx-a11y-x` 0.2.0, a maintained fork of `eslint-plugin-jsx-a11y` that supports ESLint 10 flat config. `strict` in ui, `recommended` in web. |
| Forms (web) | react-hook-form 7.90.0 + `@hookform/resolvers` 5.9.1 with the contracts' Zod schemas |
| Server state (web) | TanStack Query 5.104.2 |

## Why React Aria over the alternatives
- Radix UI: good dialog, menu and tabs, but no date picker, combobox or drop zone. Those would come from three more libraries with three different focus models.
- Base UI: promising and close to Radix in scope, but it also has no date picker and its combobox is younger.
- Headless UI: too small a set (no date picker, no toast).
- React Aria covers every primitive in the brief, including a localised date field and calendar (en-GB day-month-year now, KA/RU later), a drop zone with a keyboard path, and press handling that behaves the same across mouse, touch and keyboard. Its ARIA patterns are tested against screen readers by Adobe.

## Consequences
- Bundle: React Aria is not small. The shell route ships 148 KB gzip on first load, of which react-dom and the Next runtime are 113 KB. `packages/ui` declares `sideEffects` so unused components drop out of route bundles. Keep zod out of shell-level client code: the contracts index is about 37 KB gzip.
- Toasts use React Aria's `UNSTABLE_Toast*` API. It is wrapped in `components/toast/Toast.tsx`, so a rename touches one file.
- Storybook lives in `packages/ui`, not `apps/web/.storybook` as the WS-04 brief suggested. Stories cover the kit and the app shell components (which take data through props). That keeps ui free of app imports, and Storybook needs no Next.js framework adapter.
- The test runner is the Vitest addon, not the older Jest-based `@storybook/test-runner`. It runs in the same Vitest the repo already uses, and stories pick a viewport with `globals.viewport` (the shell has a 360px story).
- Static a11y lint catches only part of the problem. axe on every story and the Playwright e2e suite (WS-06/07) carry the rest.
- Money components never use JS numbers. `MoneyInput` parses text digit by digit into bigint minor units and hands back the wire string. Formatting uses `Intl.NumberFormat` on exact decimal strings. The local helper in `ui/src/money/format.ts` is meant to give way to `packages/domain/src/format.ts` (WS-01) once both are on main.
