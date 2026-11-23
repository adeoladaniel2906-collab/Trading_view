# Phase B Research: TradingView Feature Parity and Trading Workflow

**Status:** Research baseline and implementation backlog  
**Research date:** 2026-11-23  
**Scope:** Chart workspace, technical analysis, market monitoring, risk planning, replay, and paper-trading workflow  
**Product constraint:** This project is an independent charting platform. TradingView is a feature reference, not a source of copied code, branding, proprietary scripts, or licensed market data.

## 1. Research method and product boundary

This inventory is based on TradingView's public Supercharts help material and feature pages. It captures the documented feature families and examples, not every proprietary/community script or every plan-specific entitlement. TradingView states that Supercharts has 110+ smart drawing tools, 20+ chart types, 400+ built-in indicators and strategies, multi-chart layouts up to 16 charts, alerts, screeners, and order-flow chart types. Exact availability depends on TradingView plan and data entitlements.

Our implementation must be original, provider-neutral, tested, and consistent with the existing architecture blueprint. We will not claim complete TradingView parity until each feature is implemented and verified.

## 2. Feature inventory

### 2.1 Chart display and navigation

**Reference capabilities**
- Candlesticks, hollow candles, volume candles, OHLC bars, high-low bars.
- Line, line-with-markers, step-line, area, HLC area, baseline, and columns.
- Heikin Ashi.
- Price-based charts: Renko, Line Break, Kagi, Point & Figure, and Range.
- Advanced/order-flow views: Volume Footprint, Session Volume Profile, and Time Price Opportunity (TPO).
- Chart comparison/overlay, custom spreads, custom intervals, chart export, timezone and price-scale controls.
- Crosshair, zoom, pan, auto-fit, logarithmic/percentage scales, and viewport controls.
- Up to 16 synchronized charts in TradingView's advertised feature set.

**Our delivery**
- Keep candlesticks as the first fully supported type.
- Add line, area, baseline, OHLC bars, and Heikin Ashi only after deterministic transformations and chart regression tests exist.
- Add price-based and order-flow chart types only when the data model supports their semantics. Do not fake footprint, bid/ask delta, or TPO using ordinary candle volume.
- Add comparison series only with explicit normalization/scale rules.
- Build a bounded 1/2/4-panel layout first; design the model so 8/16 panels can be considered after measured performance and subscription limits.

### 2.2 Drawing and annotation tools

TradingView's public drawing-tools guide groups tools into the following families. This is the reference catalogue for our own drawing roadmap.

**Cursors and selection**
- Crosshair, dot, arrow, eraser.
- Select, move, resize, delete, hide, lock, and object-tree management.
- Magnet snapping (weak/strong), keep-drawing mode, hide/remove controls, and drawing synchronization.

**Trend and price-level tools**
- Trendline, ray, info line, extended line, trend angle.
- Horizontal line, horizontal ray, vertical line, crossline.
- Parallel channel, regression trend, flat-top/bottom channel, disjoint channel.
- Classic, inside, Schiff, and modified Schiff pitchforks.

**Fibonacci and Gann**
- Fibonacci retracement, trend-based extension, channel, time zone, speed-resistance fan, trend-based time, circles, spiral, speed-resistance arcs, wedge, and pitchfan.
- Gann box, fixed square, square, and fan.

**Patterns and cycles**
- XABCD, Cypher, Head-and-Shoulders, ABCD, triangle, three-drives, and Elliott-wave annotations.
- Cyclic lines, time cycles, and sine line.

**Forecasting, position, and measurement**
- Long-position and short-position risk/reward drawings.
- Position forecast, bars pattern, ghost feed, sector.
- Anchored VWAP, fixed-range volume profile, anchored volume profile.
- Price range, date range, date-and-price range, and bar-count measurement.

**Shapes and annotations**
- Brush/freehand, arrows, geometric shapes, curves, rectangles, text/notes, images, icons/stickers, and tables.

**Our delivery order**
1. Complete the current horizontal-level and trend-line interaction model.
2. Add selection, drag/edit, delete, lock/hide, object list, magnet snapping, and keyboard undo/redo.
3. Add rectangles/zones, rays, vertical lines, parallel channels, and measurement tools.
4. Add Fibonacci retracement/extension and long/short position risk-reward drawings.
5. Add pitchforks, Gann, pattern annotations, anchored VWAP, and volume-profile drawings.
6. Add remaining advanced annotations only after interaction, coordinate, serialization, and mobile usability tests.

Every drawing must be a versioned domain object with chart identity, normalized time/price anchors, style, owner/workspace scope, and deterministic undo/redo commands. Do not persist chart-library pixel coordinates.

### 2.3 Indicators and technical analysis

**Reference capabilities**
- Hundreds of built-in indicators and strategy templates, plus community scripts.
- Trend, momentum, volatility, volume, and pattern categories.
- Indicators in overlays or separate panes; indicator-on-indicator composition.
- Multi-timeframe analysis, templates, configurable inputs, and alert conditions.
- Examples include moving averages, RSI, MACD, Bollinger Bands, ATR, VWAP, volume, and volume profile.

**Our delivery**
- Implement a validated indicator registry with typed parameters, versioning, warm-up rules, missing-data behavior, and deterministic reference fixtures.
- Priority catalogue: SMA, EMA, WMA, VWMA (only when valid volume exists), RSI, MACD, Bollinger Bands, ATR, Stochastic, OBV, and VWAP (with explicit session/volume semantics).
- Support overlay and oscillator panes, visibility, parameter editing, and saved templates.
- Every indicator must disclose its formula and limitations. Do not present indicator output as a guaranteed signal.
- Community scripts and Pine Script compatibility are separate milestones requiring a language specification and sandbox.

### 2.4 Watchlists, symbol discovery, and market context

**Reference capabilities**
- Symbol search, watchlists, instrument details, news, comparison, and screeners for multiple asset classes.
- Economic and corporate calendars, news flow, fundamentals, macro maps, yield curves, and options tools.

**Our delivery**
- Expand curated symbol search into provider-backed instrument metadata and capability-aware discovery.
- Add named watchlists, ordering, notes, and workspace persistence after authentication/storage design.
- Add market overview and instrument details only where reliable provider data is available.
- Build crypto and forex screeners from supported, licensed fields first. Do not show unsupported equity/fundamental data as if it exists.
- Calendar/news/fundamentals/options/yield curves require dedicated data providers, licensing, source timestamps, and provenance before UI implementation.

### 2.5 Alerts and notifications

**Reference capabilities**
- Price alerts, technical/indicator alerts, drawing/position alerts, watchlist alerts, expiration, and alert messages.
- Notification surfaces and alert management.

**Our delivery**
- Add server-evaluated price crossing/above/below alerts with deduplication, expiry, delivery state, and audit records.
- Add indicator and drawing alerts only after deterministic evaluation and persistence exist.
- Use bounded alert quotas and rate limits.
- Browser-only timers are not reliable alert infrastructure. Do not claim an alert is active unless the server has persisted and acknowledged it.

### 2.6 Replay, strategy research, and backtesting

**Reference capabilities**
- Bar Replay for stepping through historical bars.
- Strategy scripts, strategy tester, performance reports, and trade export.

**Our delivery**
- Add deterministic replay from historical candles with play/pause, step, speed, and reset.
- Prevent future-candle leakage: calculations and strategy logic receive only data available at the replay cursor.
- Add a backtest engine only after fee, spread, slippage, fill, partial-candle, and missing-data assumptions are explicit.
- Include out-of-sample evaluation and reproducible run configuration.
- Paper-trading simulation must remain separate from real brokerage execution.

### 2.7 Trading and execution workflow

TradingView documents order tickets, chart trading, keyboard order actions, and Depth of Market (DOM), depending on connected broker support.

**Our delivery boundary**
- Phase B may include a trade-planning ticket that does not send orders.
- Add risk calculator, position sizing, entry/stop/target planner, risk/reward display, pip/tick/contract-value handling, fee assumptions, and exposure summary.
- Add paper-trading ledger, trade journal, setup checklist, and post-trade review.
- Real order routing, broker credentials, account balances, DOM execution, and live order modification are excluded from Phase B. They require a separate threat model, broker review, legal/compliance review, risk engine, permission gate, and explicit user approval.

## 3. Additional tools to make trading easier

These are original product additions, not claims about TradingView features.

1. **Risk-based position sizing:** Calculate quantity from account equity, risk percentage or fixed risk, entry, stop, contract/lot size, and instrument point value.
2. **Risk/reward planner:** Show stop distance, target distance, reward-to-risk ratio, estimated loss/profit, and invalid configurations before a trade is planned.
3. **Trade checklist:** User-defined pre-trade checks such as trend context, setup confirmation, event risk, liquidity, and maximum daily loss.
4. **Trade journal:** Record thesis, screenshot/reference, planned vs actual entry/exit, risk, result, tags, and lessons.
5. **Daily risk dashboard:** Track planned risk, realized/unrealized paper P&L, consecutive losses, drawdown, and user-defined daily stop.
6. **Multi-timeframe context panel:** Show selected higher/lower timeframe trend and indicator state without mixing candle timestamps.
7. **Session and volatility context:** Show market session/timezone and volatility regime only when reliable market calendars and data exist.
8. **Alert-to-plan workflow:** Convert an alert into a draft trade plan; never convert an alert into an order automatically.
9. **Replay-to-journal workflow:** Save a replayed setup and its exact data range/strategy version for later review.
10. **Data quality warning:** Prominently flag stale feeds, unresolved gaps, provider limitations, and missing volume before users rely on calculations.

Risk calculators must clearly label estimates. Forex pip value, CFD contract size, futures point value, spot quantity, fees, funding, and leverage differ by instrument and venue. The system must require the relevant instrument metadata rather than applying one universal formula.

## 4. Implementation roadmap

### Phase B1 — Workspace and chart controls
- Modular workspace state and bounded 1/2/4-panel layouts.
- Independent market, symbol, timeframe, history, and SSE lifecycle per panel.
- Layout synchronization options (symbol/timeframe/crosshair/drawings) with explicit toggles.
- Chart type selector for the first verified chart types.
- Responsive controls and keyboard accessibility.

### Phase B2 — Drawing system
- Finish selection/edit/delete/lock/hide and object tree.
- Add rectangles/zones, rays, vertical lines, channels, and measurement tools.
- Add serialization and persistence only after chart identity and ownership are defined.
- Add Fibonacci and position risk/reward drawings.

### Phase B3 — Indicator system
- Registry, parameter schemas, calculation engine, overlays and panes.
- Priority indicator catalogue and reference fixtures.
- Saved indicator templates and alert-ready outputs.

### Phase B4 — Trading assistance
- Risk-based sizing and risk/reward planner.
- Trade plan ticket (non-executing).
- Paper-trading ledger, journal, checklist, and risk dashboard.

### Phase B5 — Monitoring and research
- Persistent server-side alerts.
- Bar replay and replay-to-journal.
- Screener foundations and multi-timeframe context.
- Provider-backed news/calendar/fundamentals only when entitlements are verified.

### Later phases
- Script language and sandbox.
- Deterministic backtesting and strategy tester.
- AI read-only market analysis with evidence and uncertainty.
- Optional broker execution only as a separately approved phase.

## 5. Non-negotiable engineering rules

- Browser code never connects directly to vendor WebSockets and never receives provider credentials.
- Do not add API-key tests or change API-key handling in this Phase B work.
- Do not invent prices, volume, symbols, exchange metadata, news, calendars, or provider entitlements.
- Each panel has an independent, bounded data subscription; shared identical subscriptions are deduplicated by the backend hub.
- Multi-panel count and per-user subscriptions must be bounded to prevent resource exhaustion.
- Indicator and replay calculations are deterministic and tested against fixtures.
- No look-ahead bias in replay or backtesting.
- Risk tools are calculators and planning aids, not financial advice or guarantees.
- No broker execution, account access, or autonomous trading in Phase B.
- Reuse the existing palette and components. No AI-generated imagery and no arbitrary colour redesign.
- Run lint, typecheck, unit tests, dependency audit, build, and CodeQL before merge. Add browser interaction tests for pointer-heavy chart features before calling them complete.

## 6. Official research references

- TradingView Supercharts overview: https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/
- TradingView drawing tools catalogue: https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/
- TradingView chart types: https://www.tradingview.com/support/solutions/43000703407-chart-types-available-on-tradingview/
- TradingView feature overview: https://www.tradingview.com/features/
- TradingView long/short position tool calculations: https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/
- TradingView trading workflow: https://www.tradingview.com/support/solutions/43000756695-how-to-trade-on-tradingview/
- TradingView chart configuration: https://www.tradingview.com/support/solutions/43000748166-how-to-configure-your-supercharts/
- TradingView alert types: https://www.tradingview.com/support/solutions/43000696403-alerts-separation-by-type/

## 7. Definition of done

A feature is complete only when:
- Its behavior and unsupported cases are documented.
- Its data inputs and provider entitlements are explicit.
- Its state ownership and persistence model are defined.
- Unit and integration tests cover calculations and lifecycle behavior.
- Browser tests cover pointer, keyboard, responsive, and accessibility behavior where applicable.
- Performance/resource limits are measured.
- Security review confirms no secret exposure or untrusted code execution.
- UI clearly distinguishes live data, historical data, stale data, simulated data, and unavailable data.


## 8. Verified implementation status (2026-11-23)

This section records what is actually merged or under review. A roadmap item is not considered complete merely because a design document or first implementation slice exists.

| Workstream | Verified status | Remaining Phase B work |
|---|---|---|
| B1 Workspace | Multi-panel layouts, independent panel feeds, chart types, symbol/timeframe/crosshair/drawing synchronization, and named watchlists with ordering and notes are merged. | Browser/mobile regression suite. |
| B2 Drawings | Six core drawing tools, object management, edit/rename/lock/hide/delete, snapping, undo/redo, and browser-local context-isolated persistence are merged. | Channels and advanced tools; full pointer/touch regression coverage; stronger viewport and multi-panel sync tests. |
| B3 Indicators | Eleven core indicators are merged with editable per-panel periods, multipliers and OHLC-derived price sources. Workspace snapshots migrate through v4. | Independent reference fixtures, browser pane regression, and the 400+ built-in indicator/strategy catalogue remain. Named local indicator templates are merged. |
| B4 Trading assistance | Non-executing risk planner with conservative quantity precision, local manual paper journal, planned/open/closed/cancelled lifecycle and basic risk summary are merged. | Instrument-aware pip/tick/contract value and fee assumptions; journal templates; strategy checklist; broader daily risk dashboard. |
| B5 Monitoring | Deterministic historical bar replay is merged. | Persistent server-side alerts; replay-to-journal; screener foundations; multi-timeframe context; provider-backed news/calendar/fundamentals only after entitlements are verified. |
| B5 Monitoring/research | Deterministic historical bar replay is merged. | Authenticated persistent server-side alerts, screener foundations, multi-timeframe context and replay-to-journal. |
| Phase C | Not started. | Secure script language/runtime and deterministic backtesting are later phases. |

### Persistence boundary

Workspace, watchlist and drawing persistence currently belongs to the browser profile. It does not provide account identity, cloud synchronization, or cross-device recovery. Server-side alerts and shared user records remain blocked until authentication, database ownership, retention and backup decisions are implemented. Browser timers are not a substitute for persistent server-side alert evaluation.


### Phase A data-alignment note

Twelve Data daily, weekly and monthly Forex timestamps are interpreted using the provider-reported `Australia/Sydney` exchange timezone, including daylight-saving transitions. Missing or mismatched exchange-timezone metadata fails closed. This aligns candle boundaries; it does not supply a holiday/session calendar, so gap completeness must still remain degraded when that calendar is unavailable.
