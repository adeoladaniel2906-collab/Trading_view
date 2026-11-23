# Phase B1: Multi-panel workspace design

**Status:** Design baseline for implementation  
**Base:** main at c6a11ef8ea8e810982515b707fccb23b840e105d  
**Scope:** Bounded 1/2/4 chart panels with isolated client data lifecycles.

## 1. Current evidence

The current web application owns one market, symbol, timeframe, candle history, live candle, feed status, and EventSource lifecycle in apps/web/src/app.tsx. The chart renderer in apps/web/src/features/chart/market-chart.tsx owns a single Lightweight Charts instance. The API LiveMarketDataHub already deduplicates identical market/symbol/timeframe provider channels and enforces a per-client subscription cap (default 5).

This is a single-chart implementation. It must not be described as multi-chart capable.

## 2. Decision

Introduce a workspace model containing exactly 1, 2, or 4 active panels in this increment. Each panel has a stable client-generated ID and independent market, symbol, timeframe, historical request, feed status, live candle, chart viewport, indicators, and drawing state.

The layout controls only panel count and arrangement. Panel state must not be stored in positional array indexes because removing or rearranging a panel must not transfer its symbol or data lifecycle to another panel.

The active-panel count is bounded at four. The backend remains authoritative for subscription limits. The UI must surface a capacity error instead of silently dropping streams. Identical subscriptions may be shared by the existing server hub; separate panels still own separate browser EventSource connections in the first implementation. A later multiplexed SSE endpoint may reduce browser connection overhead, but is not a prerequisite for correctness.

## 3. State model

    type WorkspaceLayout = 1 | 2 | 4;

    interface ChartPanelState {
      id: string;
      market: "crypto" | "forex";
      symbol: string;
      timeframe: Timeframe;
      showSma: boolean;
      showEma: boolean;
    }

    interface WorkspaceState {
      layout: WorkspaceLayout;
      activePanelId: string;
      panels: readonly ChartPanelState[];
      sync: {
        symbol: boolean;
        timeframe: boolean;
        crosshair: boolean;
        drawings: boolean;
      };
    }

Validation rules:
- Layout is exactly 1, 2, or 4.
- Panel IDs are unique.
- Active panel ID references an existing panel.
- Panel count equals layout count.
- Symbols belong to the curated supported-symbol set for their market until provider-backed instrument discovery exists.
- Forex timeframes are constrained to the existing supported subset.
- Sync toggles are explicit and default off.
- Changing a panel's market resets an unsupported symbol and timeframe to supported defaults.

Persisted workspace state is a later B2/B4 dependency and must not be introduced without an authentication, ownership, and storage design. The first increment is session-local.

## 4. Component boundaries

- features/workspace: panel layout state, active-panel selection, sync settings, and workspace toolbar.
- features/chart: reusable chart panel, chart renderer, and local chart lifecycle.
- features/market-data: a reusable React hook/controller that owns one panel's historical request and SSE connection, including cancellation and stale-response protection.
- features/watchlist: remains workspace-level; a symbol selection targets the active panel unless symbol synchronization is enabled.

The root App must not own N copies of the provider lifecycle. Extract the current fetch/SSE/recovery state machine into a reusable hook before rendering multiple panels. Preserve all existing event validation and recovery behavior.

## 5. Subscription and resource policy

- Maximum four panels in the UI.
- The server's per-client cap remains authoritative; do not weaken it to accommodate the UI.
- A workspace configuration that requests more streams than the server permits must show a clear per-panel unavailable/capacity state.
- EventSource and fetch AbortController are closed/aborted on panel removal, panel identity change, and unmount.
- Async history/recovery responses must be ignored after the owning panel lifecycle is disposed or its request generation changes.
- No browser connection is made to Binance or Twelve Data directly.
- Do not add credentials or API-key tests.
- No automatic retry loop beyond the existing EventSource semantics; use bounded backoff only if a deliberate retry controller is separately specified and tested.
- Measure chart rendering and event load before considering 8/16 panels.

## 6. Synchronization semantics

Synchronization is opt-in:
- Symbol sync copies the active panel's market/symbol to other panels, validating the symbol against each target market.
- Timeframe sync copies the timeframe only where supported; otherwise the target retains its current timeframe and shows a non-blocking explanation.
- Crosshair sync is a later sub-slice and must use normalized time values, not pixel coordinates.
- Drawing sync is deferred until drawing ownership, coordinate transforms, and persistence are complete.

Do not silently synchronize all panel state.

## 7. Acceptance tests

Unit tests:
- Layout transitions 1 -> 2 -> 4 -> 1 preserve surviving panel IDs and state.
- Panel creation produces unique IDs.
- Removing the active panel selects a remaining panel deterministically.
- Invalid market/symbol/timeframe combinations are rejected or normalized by an explicit reducer command.
- Symbol/timeframe synchronization respects market capabilities and unsupported Forex intervals.
- Four-panel maximum cannot be exceeded.

Component/integration tests:
- Each panel loads only its selected market/symbol/timeframe.
- Switching one panel does not mutate another panel when sync is off.
- Enabling symbol/timeframe sync updates only the declared fields.
- Unmounting a panel closes its EventSource and aborts its history request.
- Late responses from a disposed panel cannot update another panel.
- Feed health and recovery events are scoped to the matching panel.
- Provider errors and subscription-cap errors are visible without fabricating candles.

Browser tests:
- 1/2/4 layout selection and panel focus/selection.
- Independent market/symbol/timeframe selection.
- Mobile stacking and usable controls.
- Keyboard navigation and visible focus.
- Regression test for chart resize and viewport preservation.

Quality gate:
- lint, typecheck, all unit/integration tests, dependency audit, production build, CodeQL.
- No merge while any required check is pending or failing.
- No claim of real-provider verification from mocked fixtures.

## 8. Deferred items

- 8/16 panels: requires measured performance and revised global subscription quotas.
- Persistent layouts: requires identity, authorization, storage schema, migration, retention, and deletion policy.
- Crosshair/drawing synchronization: requires normalized coordinate semantics.
- Multiplexed SSE: evaluate after correctness and connection metrics.
- Multi-instance global subscription accounting: requires shared pub/sub and distributed quotas; process-local hub behavior is not sufficient for horizontal scaling.

## 9. Security and product constraints

- Reuse the existing palette and components; do not invent a new visual system.
- No AI-generated images.
- Provider credentials remain server-only.
- No API-key tests or API-key handling changes.
- No broker execution, account access, or deployment.
- Do not claim Phase B complete until all Phase B exit criteria are implemented and verified.
