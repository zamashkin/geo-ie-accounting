# WS-04 Web shell + UI kit

**Phase 1.**

## Owns
`packages/ui/**`, `apps/web/app/layout.tsx`, `apps/web/app/(auth)/**` (UI only), `apps/web/app/o/[orgId]/layout.tsx`, `apps/web/src/lib/**`, `apps/web/.storybook/**`

## Deliver
- Design tokens (CSS variables, light + dark), Tailwind preset in `packages/ui`.
- Components with Storybook stories + interaction tests: Button, Input, Select, Combobox, DatePicker, MoneyInput (string-based, no float), MoneyText, Badge, Dialog, Sheet, Toast, Tabs, EmptyState, Skeleton, DataTable (TanStack Table + Virtual, server-side sort/filter/pagination props), FileDropzone, Stepper.
- App shell: sidebar nav per ARCHITECTURE §9, org switcher (placeholder data), user menu, responsive (≥ 360px).
- `src/lib`: typed API client wrapper (cookie auth, problem+json → typed error), TanStack Query provider, URL search-param state helper for tables, SSE hook `useOrgEvents(orgId)` typed by `contracts/events.ts`.
- Auth pages UI (forms wired to API once WS-05 lands; otherwise mock).

## Acceptance
- Storybook builds in CI; axe checks pass on all stories.
- DataTable renders 50k rows smoothly (story with generated data).
- No component imports from `apps/*`.
