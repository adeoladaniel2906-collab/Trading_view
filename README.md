# Market Workspace

An independent market-charting and analysis platform. The repository does not provide trading execution, investment advice, or live market prices until a licensed data provider is configured.

## Architecture

- apps/web: React, TypeScript, Vite, and TradingView Lightweight Charts.
- apps/api: Fastify HTTP API and provider boundary.
- packages/contracts: shared Zod schemas and TypeScript contracts.

The browser renders charts. The API owns market-data provider credentials and upstream requests. Providers implement a narrow interface and cannot bypass shared OHLCV validation. The frontend never receives provider secrets.

## Charting and market data

The chart renderer uses Lightweight Charts 5.3.0. It is a chart-rendering library, not a market-data service. Its required attribution is included in the application footer and the root NOTICE file.

The API exposes GET /v1/markets/:symbol/candles with timeframe and limit query parameters. A provider is injected into the API at application construction. If no provider is configured, the endpoint returns 503 instead of inventing prices. Provider output is checked for finite OHLCV values, valid high/low bounds, non-negative volume, and strictly ascending unique Unix-second timestamps.

Supported timeframe contracts: 1m, 5m, 15m, 1h, 4h, 1d, and 1w. The maximum candle request is 2,000 items.

No vendor adapter is selected in this phase. Before choosing one, compare exchange coverage, licensing and redistribution rights, historical depth, streaming support, latency, reliability, rate limits, and total cost. Provider credentials must remain server-side.

## Local setup

1. Use Node.js 24 and pnpm 10.
2. Copy .env.example to .env.
3. Run pnpm install.
4. Run pnpm dev.
5. Open the Vite URL shown in the terminal. The API health endpoint is http://127.0.0.1:3000/health.

The API binds to loopback by default. Set HOST=0.0.0.0 only when the deployment environment requires an externally reachable container port. Set WEB_ORIGINS to exact HTTPS origins in production.

## Quality checks

- pnpm check
- pnpm typecheck
- pnpm test
- pnpm audit
- pnpm build

## Security notes

- No secrets belong in source control or VITE_ variables.
- Provider errors are returned as generic upstream errors and are not forwarded to clients.
- Market-data responses are runtime-validated before leaving the API.
- API request limits, CORS allowlisting, security headers, request-size limits, and log redaction remain enabled.
- The current in-memory rate limiter is suitable only for a single API instance. Production multi-instance deployments need a shared store.
- Authentication, authorization, persistent storage, alerts, and production deployment hardening remain separate future milestones.
