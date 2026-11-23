# Market Workspace

An independent market-charting and analysis platform. The repository does not provide trading execution, investment advice, or live market prices until a licensed data provider is configured.

## Architecture

The implemented baseline and proposed target design are documented in [the Architecture Blueprint](docs/ARCHITECTURE_BLUEPRINT.md). It distinguishes current capabilities from planned components and defines security boundaries, quality gates, and the staged roadmap.

- apps/web: React, TypeScript, Vite, and TradingView Lightweight Charts.
- apps/api: Fastify HTTP API, server-side market-data credentials, and provider adapters.
- packages/contracts: shared Zod schemas and TypeScript contracts.

The browser renders charts and calls the API. Provider credentials and upstream requests remain exclusively in the API process. Never add provider keys to React code, VITE_ variables, browser storage, public runtime config, or frontend network requests.

## Charting and market data

The chart renderer uses Lightweight Charts 5.3.0. It is a chart-rendering library, not a market-data service. Its required attribution is included in the application footer and root NOTICE file.

The API exposes GET /v1/markets/:symbol/candles for the legacy default provider and GET /v1/markets/:market/:symbol/candles for explicit asset-class routing. Crypto history is served by Binance Spot; Forex history is served by Twelve Data when its display-license gate is enabled. Provider output is validated for finite OHLCV values, valid high/low bounds, non-negative volume, and strictly ascending unique Unix-second timestamps. Volume is optional because some markets do not publish centralized traded volume.

### Twelve Data adapter

A server-side Twelve Data adapter is included. It sends the API key using the provider's recommended Authorization header, never in the URL. It requests ascending UTC candles, maps supported intervals, honors abort signals, and rejects malformed or oversized upstream responses.

The adapter is disabled unless both TWELVE_DATA_API_KEY and TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED=true are configured in the API server environment. The second setting is an operator attestation, not an automatic license check. Do not enable it unless the specific subscription and exchange agreements permit displaying the data in this application.

The Twelve Data Basic/free plan is described as internal non-display usage. Do not use that plan to populate a chart. Grow lists internal display data access from $29/month, but Basic and Grow WebSocket access is restricted to one test connection and up to 8 permitted symbols. Full WebSocket access starts on Pro, currently listed from $99/month with 500 WebSocket credits. Confirm the exact exchange entitlements and redistribution terms before enabling display. No API key or paid subscription is included here.

Official references:
- https://twelvedata.com/docs/introduction
- https://twelvedata.com/docs/market-data/time-series
- https://twelvedata.com/pricing

### Multi-provider live market-data pipeline

The API now owns a live-data hub and server-side provider connections. The browser consumes a single Server-Sent Events (SSE) endpoint; it never connects directly to a vendor.

- Crypto Spot: Binance WebSocket kline streams, normalized into the shared candle event contract. Binance supports 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, and 1M intervals.
- Forex: Twelve Data WebSocket price events are aggregated server-side into OHLC candles per requested interval. UTC bucket boundaries are used; the prior candle is marked closed when the first tick in a new bucket arrives, and out-of-order older ticks are ignored.
- Provider adapters own upstream connection lifecycle, reconnect with capped exponential backoff, and resubscribe after reconnect.
- The hub shares identical market/symbol/timeframe subscriptions across clients and enforces a per-client subscription cap.
- SSE clients receive normalized events at GET /v1/markets/:market/:symbol/stream?timeframe=1m. Supported markets are crypto and forex.
- Twelve Data live subscriptions default to a conservative maximum of 8 symbols, matching the documented Basic/Grow trial ceiling. Full WebSocket access requires a Pro plan or higher.

Binance support in this phase is Spot market data, not futures or order execution. Twelve Data's price WebSocket provides ticks, not OHLC candles; the API aggregates those ticks into OHLC candles before publishing normalized events. The chart UI supports Crypto and Forex instruments, and only exposes intervals supported by the selected provider. Forex uses path-safe symbols such as EURUSD internally and maps them to the provider's EUR/USD format server-side. No provider credentials are sent to the browser. The chart currently loads up to 500 historical candles and switches its matching provider stream when the market, symbol, or interval changes.

The current live hub is process-local. A multi-instance deployment will need a shared pub/sub layer and distributed subscription accounting before scaling horizontally.

## Data contract

Supported shared timeframes: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, and 1M. Binance Spot supports all listed intervals. The Twelve Data Forex historical adapter currently exposes 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w, and 1M; the UI hides unsupported intervals for Forex. The maximum candle request is 2,000 items. If no licensed provider is configured, the endpoint returns 503 instead of inventing prices.

## Local setup

1. Use Node.js 24 and pnpm 10.
2. Copy .env.example to .env for local API settings.
3. Run pnpm install.
4. Run pnpm dev.
5. Open the Vite URL shown in the terminal (normally http://127.0.0.1:5173). The API root is http://127.0.0.1:3000/ and its health endpoint is http://127.0.0.1:3000/health.

The API root returns service information; it is not the chart website. The frontend calls the API at http://127.0.0.1:3000 by default. Development CORS allows both http://127.0.0.1:5173 and http://localhost:5173. If you change either port or host, update WEB_ORIGINS in the API environment and VITE_API_ORIGIN in the frontend environment as appropriate.

Workspace layout, panel settings, watchlists and chart drawings are saved in the current browser profile. This is local persistence only; it does not sync across devices or accounts.

For deployment, set provider credentials only in the API runtime's secret manager. Do not put them in frontend hosting environment variables. The API binds to loopback by default. Set HOST=0.0.0.0 only when the deployment environment requires an externally reachable container port. Set WEB_ORIGINS to exact HTTPS origins in production.

## Quality checks

- pnpm check
- pnpm typecheck
- pnpm test
- pnpm audit
- pnpm build

## Security notes

- .env and .env.* are ignored by Git; .env.example is the only committed environment template.
- No provider secret is exposed through the frontend build or client configuration.
- Provider credentials are sent in an Authorization header from the API only.
- Provider errors are returned as generic upstream errors and are not forwarded to clients.
- Market-data responses are runtime-validated before leaving the API.
- API request limits, CORS allowlisting, security headers, request-size limits, and log redaction remain enabled.
- The current in-memory rate limiter is suitable only for a single API instance. Production multi-instance deployments need a shared store and trusted-proxy configuration.
- Authentication, authorization, persistent storage, alerts, and production deployment hardening remain separate future milestones.
