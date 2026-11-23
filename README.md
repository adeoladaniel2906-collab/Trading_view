# Market Workspace

An independent market-charting and analysis platform. The repository does not provide trading execution, investment advice, or live market prices until a licensed data provider is configured.

## Architecture

- apps/web: React, TypeScript, Vite, and TradingView Lightweight Charts.
- apps/api: Fastify HTTP API, server-side market-data credentials, and provider adapters.
- packages/contracts: shared Zod schemas and TypeScript contracts.

The browser renders charts and calls the API. Provider credentials and upstream requests remain exclusively in the API process. Never add provider keys to React code, VITE_ variables, browser storage, public runtime config, or frontend network requests.

## Charting and market data

The chart renderer uses Lightweight Charts 5.3.0. It is a chart-rendering library, not a market-data service. Its required attribution is included in the application footer and root NOTICE file.

The API exposes GET /v1/markets/:symbol/candles. Provider output is validated for finite OHLCV values, valid high/low bounds, non-negative volume, and strictly ascending unique Unix-second timestamps. Volume is optional because some markets do not publish centralized traded volume.

### Twelve Data adapter

A server-side Twelve Data adapter is included. It sends the API key using the provider's recommended Authorization header, never in the URL. It requests ascending UTC candles, maps supported intervals, honors abort signals, and rejects malformed or oversized upstream responses.

The adapter is disabled unless both TWELVE_DATA_API_KEY and TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED=true are configured in the API server environment. The second setting is an operator attestation, not an automatic license check. Do not enable it unless the specific subscription and exchange agreements permit displaying the data in this application.

The current Twelve Data Basic/free plan is described as internal non-display usage. Do not use that plan to populate a chart. The Grow tier lists internal display data access and is currently priced from $29/month billed monthly. Confirm current terms, exchange coverage, and pricing before enabling display. No API key or paid subscription is included here.

Official references:
- https://twelvedata.com/docs/introduction
- https://twelvedata.com/docs/market-data/time-series
- https://twelvedata.com/pricing

### Multi-provider live market-data pipeline

The API now owns a live-data hub and server-side provider connections. The browser consumes a single Server-Sent Events (SSE) endpoint; it never connects directly to a vendor.

- Crypto Spot: Binance WebSocket kline streams, normalized into the shared candle event contract.
- Forex: Twelve Data WebSocket price events, enabled only when the API key and the existing display-license attestation are configured.
- Provider adapters own upstream connection lifecycle, reconnect with capped exponential backoff, and resubscribe after reconnect.
- The hub shares identical market/symbol/timeframe subscriptions across clients and enforces a per-client subscription cap.
- SSE clients receive normalized events at GET /v1/markets/:market/:symbol/stream?timeframe=1m. Supported markets are crypto and forex.
- Twelve Data live subscriptions default to a conservative maximum of 8 symbols until the account's actual entitlement is confirmed.

Binance support in this phase is Spot market data, not futures or order execution. Twelve Data's price WebSocket provides ticks, not OHLC candles; the chart candle aggregator and frontend EventSource integration are follow-on work. Do not interpret a price tick as a completed candle. No provider credentials are sent to the browser.

The current live hub is process-local. A multi-instance deployment will need a shared pub/sub layer and distributed subscription accounting before scaling horizontally.

## Data contract

Supported timeframes: 1m, 5m, 15m, 1h, 4h, 1d, and 1w. The maximum candle request is 2,000 items. If no licensed provider is configured, the endpoint returns 503 instead of inventing prices.

## Local setup

1. Use Node.js 24 and pnpm 10.
2. Copy .env.example to .env for local API settings.
3. Run pnpm install.
4. Run pnpm dev.
5. Open the Vite URL shown in the terminal. The API health endpoint is http://127.0.0.1:3000/health.

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
