# Market Workspace

An independent market-charting and analysis platform. This repository contains the application foundation only; it does not yet provide live prices, trading execution, investment advice, or a production authentication system.

## Architecture

```text
apps/
  web/       React + Vite browser application
  api/       Fastify HTTP API
packages/
  contracts/ Shared runtime schemas and TypeScript contracts
```

The frontend and API are separate deployable applications. Shared contracts are a small package, not a shared database or a dependency on server implementation details.

### Technology choices

- React and TypeScript for the browser application.
- Vite for frontend development and production builds.
- Fastify 5 for the API and its plugin-based security boundary.
- Zod for runtime validation of environment configuration and shared contracts.
- pnpm workspaces for dependency and package boundaries.
- Biome for consistent formatting and lint checks.
- Node's built-in test runner for API integration tests.

Market-data adapters, chart rendering, persistence, authentication, and alert delivery are intentionally deferred. The first market-data adapter must be selected only after reviewing provider coverage, licensing, latency, rate limits, and cost.

## Requirements

- Node.js 24 LTS
- pnpm 10

## Local setup

1. Copy `.env.example` to `.env`.
2. Install dependencies: `pnpm install`.
3. Build the shared contracts and start both applications: `pnpm dev`.
4. Open the Vite URL shown in the terminal (normally http://localhost:5173).
5. The API health endpoint is http://127.0.0.1:3000/health.

The API binds to loopback by default. Set `HOST=0.0.0.0` only when the deployment environment requires an externally reachable container port. In production, set `WEB_ORIGINS` to the exact HTTPS origin(s) of the deployed frontend.

## Quality checks

- `pnpm check` - lint checks.
- `pnpm format` - apply consistent formatting.
- `pnpm typecheck` - TypeScript checks for all workspaces.
- `pnpm test` - API integration tests.
- `pnpm build` - production builds.
- `pnpm audit` - dependency vulnerability audit.

Commit the generated `pnpm-lock.yaml` after the first install. CI currently resolves exact direct dependency versions and runs the same checks; once the lockfile is committed, switch CI installs to frozen-lockfile mode.

## Security baseline

- No secrets belong in source control or in `VITE_*` variables.
- API configuration is parsed and validated at startup.
- CORS uses an explicit origin allowlist and does not enable credential sharing.
- Helmet security headers and global API rate limiting are enabled.
- Proxy headers are not trusted by default.
- Request bodies are size-limited; request identifiers are generated server-side.
- Sensitive request/response fields are redacted from logs.
- Validation errors return a generic client response; internal errors are not exposed.
- CI runs dependency auditing and automated code checks.

This is a foundation, not a completed production security review. Before public launch, add authentication and authorization, database access controls, persistent distributed rate limiting, observability, backups, deployment-specific CSP, secret management, and an independent security review.
