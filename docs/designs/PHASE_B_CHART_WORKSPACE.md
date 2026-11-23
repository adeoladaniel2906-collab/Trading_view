# Phase B: Chart Workspace

## Goal

Build the user-facing chart workspace on top of the normalized market-data boundary. The frontend must consume normalized candles only; it must not open provider WebSockets, store provider credentials, or bypass server-side licensing gates.

## Implemented in the first slice

- Market and instrument selection for the currently supported curated symbol set.
- Symbol search over that curated set. Search is not presented as a complete exchange-wide instrument directory.
- Per-market in-memory watchlists with add/remove and quick selection.
- Optional SMA(20) and EMA(20) overlays calculated from validated historical candles plus the current forming live candle.
- Pure indicator calculations with deterministic unit tests.
- Chart overlays reuse the existing interface palette. No generated imagery or new palette has been introduced.
- The API key configuration and API-key verification tests are intentionally outside this phase slice, as requested.

## Boundaries

- `apps/web/src/app.tsx` owns workspace selection state and normalized API/SSE consumption.
- `apps/web/src/features/chart/market-chart.tsx` owns chart rendering and series lifecycle.
- `apps/web/src/features/chart/indicators.ts` contains pure indicator calculations.
- The market-data API remains responsible for provider routing, history and recovery.
- Watchlists are currently in-memory only. Persistence and user accounts are not introduced by this slice.

## Next Phase B increments

1. Add persistent watchlists only after an explicit storage/authentication design.
2. Add multi-panel layouts with one isolated market-data subscription lifecycle per panel and a bounded panel count.
3. Add drawing tools (horizontal levels, trend lines, selection, deletion) with undo/redo and chart-coordinate tests.
4. Expand the indicator registry with parameter validation, warm-up rules and test vectors.
5. Add keyboard accessibility, focus management, responsive layout tests and browser-level chart interaction tests.

## Explicitly out of scope

- Provider API-key testing or credential changes.
- Trade execution, broker account access or autonomous actions.
- Claiming the curated symbol list is exhaustive.
- Treating an indicator as a trading recommendation.
