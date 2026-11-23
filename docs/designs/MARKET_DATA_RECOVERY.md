# Market Data Recovery and Feed Health Design

**Status:** Proposed detailed design  
**Parent architecture:** [Architecture Blueprint](../ARCHITECTURE_BLUEPRINT.md)  
**Implementation status:** Not implemented by this document.

## 1. Problem statement

The current live pipeline can reconnect and resubscribe, but reconnecting a WebSocket does not recover market events missed while disconnected. A browser may therefore display a plausible-looking candle series with an unobserved gap.

This design adds an explicit feed lifecycle and historical reconciliation. The system must show uncertainty rather than silently imply continuity.

## 2. Scope

In scope:
- Per-subscription feed state and stale-feed detection.
- Historical backfill after provider reconnect.
- Candle merge, deduplication, and ordering.
- Recovery status exposed to the browser.
- Tests for gaps, duplicate events, out-of-order events, and provider outages.

Out of scope:
- Automatic multi-provider failover.
- Trade execution.
- Tick-level reconstruction when a provider only exposes OHLC candles.
- Guaranteeing that every Forex market tick was observed.
- Distributed coordination for multi-instance deployments.

## 3. Core invariants

1. A candle is uniquely identified by market, symbol, timeframe, and candleTime.
2. Candle time is the UTC interval start in Unix seconds.
3. A provider event is never accepted without schema and identity validation.
4. Older events must not overwrite newer candle state.
5. Historical reconciliation is bounded and rate-limited.
6. A feed is not healthy merely because a socket is open.
7. A feed with unresolved gaps is recovering or degraded, not live.
8. The browser cannot select a provider directly or bypass capability and licensing checks.
9. Merges are deterministic for the same ordered input set.
10. Provider timestamps and server receive timestamps remain distinct.

## 4. Subscription lifecycle

Proposed states:
- idle: no upstream subscription.
- connecting: connection attempt in progress.
- subscribing: socket is open; requested stream subscription is being initialized.
- live: valid recent events are arriving and no known gap is pending.
- stale: no valid event has arrived within the market/timeframe-specific threshold.
- recovering: reconnect succeeded and historical reconciliation is in progress.
- degraded: provider is unavailable, reconciliation failed, or a gap cannot be repaired.
- closed: subscription has no consumers and has been disposed.

State transitions:

    stateDiagram-v2
      [*] --> idle
      idle --> connecting: first consumer
      connecting --> subscribing: socket open
      connecting --> degraded: connect failure
      subscribing --> live: first valid event
      subscribing --> degraded: subscribe failure or timeout
      live --> stale: event age exceeds threshold
      live --> recovering: disconnect or sequence gap
      stale --> recovering: reconnect and backfill starts
      stale --> degraded: recovery timeout
      recovering --> live: backfill complete, no unresolved gap
      recovering --> degraded: backfill failed or gap unresolved
      degraded --> connecting: retry budget permits
      live --> closed: final consumer leaves
      degraded --> closed: final consumer leaves
      closed --> [*]

The state machine is per logical subscription, not just per provider socket. One provider connection may carry many symbols and timeframes with different health states.

## 5. Feed-health contract

Proposed shared contract:

    type FeedState =
      | "connecting" | "subscribing" | "live"
      | "stale" | "recovering" | "degraded";

    interface FeedHealth {
      market: "crypto" | "forex";
      symbol: string;
      timeframe: string;
      provider: string;
      state: FeedState;
      lastEventAt: number | null;
      lastReceivedAt: number | null;
      lastClosedCandleAt: number | null;
      recoveryStartedAt: number | null;
      unresolvedFrom: number | null;
      messageCode:
        | "CONNECTING" | "WAITING_FOR_FIRST_EVENT" | "HEALTHY"
        | "STALE_FEED" | "RECONNECTING" | "BACKFILLING"
        | "RECOVERY_FAILED" | "GAP_UNRESOLVED";
    }

The API sends structured status events over the existing SSE connection, separate from candle events. User-facing messages are mapped from stable message codes; raw provider errors are never sent to the browser.

## 6. Gap detection

### Candle-based streams

- Track the last observed candle open time and whether it is open or closed.
- On reconnect, calculate the first potentially missing interval from the last confirmed closed candle.
- Request historical candles with a bounded overlap to account for boundary races.
- Do not infer a missing candle from elapsed wall-clock time alone for markets that may be closed.

### Tick-based streams

- Track provider event timestamp separately from server receive time.
- Use market-session metadata where available; Forex is not a 24/7 market.
- A quiet market is not automatically a disconnected market.
- After reconnect, request licensed historical OHLC candles for the affected interval range.
- Do not claim tick-level completeness from OHLC backfill.
- Preserve the source distinction between tick-aggregated candles and provider historical candles.

Stale thresholds must be configurable by provider, market, and timeframe. They should be based on observed provider behavior and market sessions. A missing-event threshold is an operational signal, not proof of a data gap.

## 7. Reconciliation algorithm

Inputs: logical subscription identity, last confirmed closed candle, current in-progress candle, provider capabilities and history limits, maximum backfill window.

1. Transition subscription to recovering.
2. Freeze the last confirmed boundary and record recovery start time.
3. Request historical candles from a bounded point before the boundary through the provider's latest available point.
4. Validate response size, schema, symbol, timeframe, provider identity, OHLC invariants, and timestamp ordering.
5. Normalize timestamps to UTC interval starts.
6. Merge by candle identity. Historical candles provide gap coverage; the most recent valid live event may update the current open candle only if it is newer and belongs to the same interval.
7. Reject conflicting duplicates unless an explicit source-precedence rule applies. Record a diagnostic counter for conflicts.
8. Recompute derived indicators for the corrected range.
9. Publish recovery-complete status with the last reconciled candle and any unresolved range.
10. Transition to live only when configured completeness criteria are satisfied; otherwise transition to degraded.

Do not merge by array position. Do not rely on browser clocks to order provider events. Use provider event time and canonical candle time, retaining server receive time for diagnostics.

## 8. Source precedence

Proposed default:
- For completed candles, prefer the same provider's historical candle response when reconciliation is explicitly run.
- For the currently open candle, accept the latest valid live update after checking its interval and event ordering.
- Never combine a Binance candle with a Twelve Data candle for the same canonical series.
- Never silently change providers during recovery.
- A future provider failover feature must declare provider identity changes and possible data discontinuity.

For Forex, historical OHLC and tick-aggregated OHLC may differ because they can use different aggregation rules or data coverage. Retain provenance and surface a source correction rather than pretending the values are identical.

## 9. SSE event envelope

Keep candle and status events distinct:

    type MarketStreamEvent =
      | { type: "feed-health"; data: FeedHealth }
      | { type: "candle"; data: LiveMarketEvent }
      | {
          type: "recovery-complete";
          data: {
            market: "crypto" | "forex";
            symbol: string;
            timeframe: string;
            reconciledThrough: number;
            unresolvedFrom: number | null;
          };
        };

The current SSE endpoint already uses named events. Add status and recovery event names without changing the normalized candle payload unexpectedly. Version the envelope if a breaking contract change is required.

EventSource automatic reconnection is not a complete replay protocol. A later enhancement should add event IDs and a bounded server-side replay buffer, or require a historical refresh on every browser reconnect.

## 10. Backpressure, retries, and quotas

- Reconciliation requests use a per-subscription single-flight lock.
- Multiple reconnect notifications must not launch duplicate history requests.
- Retry uses capped exponential backoff with jitter.
- Provider rate limits and account entitlements are enforced centrally.
- Maximum backfill candles and elapsed range are bounded.
- Slow SSE consumers are disconnected or forced to resynchronize; queues remain bounded.
- Recovery must not starve new subscriptions or normal historical chart requests.
- Metrics include backfill count, duration, candles requested, candles merged, duplicate conflicts, unresolved gaps, and recovery failures.

## 11. Security and failure behavior

- All provider requests remain server-side.
- Provider credentials never appear in SSE payloads, logs, traces, or exception messages.
- Provider responses are untrusted input.
- User-controlled symbol and timeframe values are validated against the capability registry.
- Per-user and per-IP limits apply before opening upstream subscriptions.
- If historical data is unavailable, emit degraded status and preserve last known chart data with a visible stale marker.
- Never fabricate candles to bridge gaps.

## 12. Test plan

Unit tests:
- Candle identity and UTC interval normalization.
- Deterministic merge of sorted and unsorted inputs.
- Duplicate candle handling.
- Out-of-order live event rejection.
- Historical correction of an open or recently closed candle.
- Provider source mismatch rejection.
- State transition legality.
- Market-session-aware stale evaluation.
- Single-flight reconciliation and retry limits.

Integration tests:
- Binance disconnect, missed candles, reconnect, and history reconciliation.
- Twelve Data disconnect, Forex historical backfill, and source provenance.
- Provider history failure leaves feed degraded and chart data intact.
- Slow SSE client cannot create unbounded buffering.
- Browser receives status changes before and after recovery.
- User cannot request unsupported timeframe or unlicensed provider.

Acceptance gate: reconnect recovery tests prove no known candle gap is silently marked healthy; stale and recovering states are visible; unresolved gaps remain visible; credentials stay server-side; tests cover duplicates, ordering, outages, and quotas; CI and CodeQL pass; real provider behavior is verified in a properly licensed test environment.

## 13. Implementation order

1. Add shared FeedHealth and status-event contracts.
2. Add a per-subscription state machine to the live hub.
3. Add a provider history-reconciliation interface.
4. Implement Binance candle reconciliation first because both stream and history provide OHLC candles.
5. Implement Twelve Data Forex reconciliation with source provenance and market-session caveats.
6. Add feed-health and recovery status to the chart UI.
7. Add integration tests and operational metrics.
8. Evaluate shared pub/sub and distributed subscription coordination before multi-instance hosting.


## Phase A implementation status

The first implementation is in main through PR #14:
- Validated feed-health SSE events for connecting, live, stale, recovering, and degraded states.
- Binance stale detection after 15 seconds without a received kline update.
- Bounded historical backfill on detected candle gaps, with a shared in-flight request per market/symbol/timeframe.
- Validation of recovered candle series and full expected-interval coverage before Binance is marked recovered.
- Browser-side timestamp merge that preserves a newer live candle.
- Forex gaps remain degraded because the current product has no provider-backed session/holiday calendar and cannot distinguish market closure from missing data.

A follow-up hardening change also refreshes the active Binance candle when the feed becomes stale, even if its candle timestamp has not advanced. This corrects the case where a reconnect happens inside the same candle and the next event would otherwise fail to trigger gap detection.

Remaining Phase A work: Forex session-aware recovery, provider socket lifecycle events, replay semantics for SSE reconnects, load/fault testing, and distributed coordination for multi-instance deployment. The current milestone does not claim complete Forex recovery or production readiness.
