# 0014 Charts: hand-rolled SVG, rendered on the server

Status: accepted (WS-08, 2026-10-17)

## Context
The dashboard needs a monthly income bar chart, income by counterparty (top 5 plus other) and the currency mix. ARCHITECTURE §9 asks for one lightweight chart library, loaded lazily, and SPEC §4 sets an LCP and JS budget for the dashboard.

## Decision
No chart library. `apps/web/app/o/[orgId]/_components/charts.tsx` draws the monthly bars as inline SVG and the counterparty and currency figures as horizontal HTML bars. They are server components, so they ship no JavaScript and there is nothing to lazy-load. Geometry comes from bigint amounts by integer division (`src/lib/chart-scale.ts`); floats only place marks and never become money. Hover details use SVG `<title>`. The monthly chart has a "Show as a table" view, and the bar lists carry their figures as text.

## Alternatives
- Recharts, visx or Chart.js: 40 to 100 kB of client JavaScript for three simple charts, plus a client boundary and lazy loading to stay in budget.
- uPlot: small, but it draws on a canvas, so it needs its own accessibility layer.

## Consequences
The dashboard ships no chart JavaScript. Richer interaction (crosshair, zoom, brushing) would need a client component or a library; if one is added later, it should be lazy-loaded behind `next/dynamic`.
