# Phase D: deterministic strategy research

## Strategy model v1

The first strategy adapter consumes exactly two plotted numeric series from the Phase C restricted script runtime. The first plot is the fast line; the second is the slow line. A long entry occurs when fast crosses above slow. A long exit occurs when fast crosses below slow. Short selling, leverage, pyramiding and brokerage execution are excluded.

## Execution timing and look-ahead control

Signals are evaluated using candle data through the signal candle's close. A signal generated at candle index i is filled at candle index i+1 open. The backtester never fills on the same candle that generated the signal. No future candle is passed into the script evaluator when calculating a historical value; the Phase C built-ins are causal rolling calculations.

## Costs and sizing

The request pins:
- initial capital,
- position fraction (0, 1],
- fee in basis points per side,
- spread in basis points (half-spread charged on each side),
- slippage in basis points per side,
- provider, symbol, timeframe and dataset range.

A long entry buys at next open increased by slippage plus half-spread. A long exit sells at next open reduced by slippage plus half-spread. Fees are charged on entry and exit notional. Position sizing is cash-based and does not use leverage.

## Evaluation

Results include:
- overall run,
- in-sample segment,
- out-of-sample segment starting at an explicit candle index,
- closed trades and an optional marked-to-market open position,
- equity curve, net return, max drawdown, win rate, profit factor and average trade return.

Out-of-sample is run independently from the specified split with the same initial capital and assumptions. It is not a guarantee of future performance.

## Current exclusions and exit gates

- long-only crossover baseline, not a general strategy language
- no brokerage or order execution
- no leverage, shorts, funding, borrow costs, partial fills, latency, market impact or exchange-specific fee tiers
- no persistent backtest records or comparison UI yet
- independent reference fixtures for fees, spread, slippage, drawdown and open positions are required
- no-look-ahead tests, reproducibility tests, missing-data tests, and CodeQL/CI must pass before merge
