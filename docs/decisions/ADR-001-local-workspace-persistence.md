# ADR-001: Local-first persistence for the unauthenticated chart workspace

- **Status:** Implemented for the current local-first milestone; server synchronization remains deferred
- **Date:** 2026-11-23

## Context

The chart workspace currently has no user authentication or durable server-side user-data store. Workspace layout, panel selections, indicator visibility, watchlists, and drawing records are user state, but there is no authenticated owner identity to which a backend could safely attach those records.

The application must not pretend that browser-local data is cloud-synchronized or shared across devices. Provider credentials must remain exclusively in the API runtime and must never be stored in browser persistence.

## Decision

Use versioned browser `localStorage` for the current single-browser workspace state, per-panel indicator parameters, and drawing records. Validate every loaded snapshot against the current workspace, instrument, indicator, chart-type, and drawing domain constraints before accepting it.

Persist:
- The bounded 1/2/4-panel workspace and per-panel settings.
- Supported crypto and Forex watchlists.
- Drawing records, partitioned by exact market, symbol, and timeframe.

Do not persist:
- API keys, provider credentials, session tokens, or authentication secrets.
- Live candles, event streams, or transient pointer/drag state.
- Undo/redo history, which remains an in-memory interaction detail.

Use explicit schema versions, strict payload size and collection limits, safe handling of unavailable storage, and known v1-to-v2 and v2-to-v3 migrations: v1 adds newly introduced indicator toggles as disabled; v2 adds validated default indicator parameters. Unknown future or malformed snapshots are never auto-migrated or overwritten; the UI reports that persistence is unavailable until the data is resolved.

## Alternatives considered

### Keep all state in memory

- **Benefits:** No browser persistence or migration concerns.
- **Drawbacks:** Reloading the page destroys layouts, watchlists, and drawings.
- **Assessment:** Does not meet the basic local-workspace continuity requirement.

### IndexedDB

- **Benefits:** Asynchronous transactions, larger storage capacity, better fit for richer local datasets.
- **Drawbacks:** More lifecycle and transaction complexity than the current small bounded settings payload requires.
- **Assessment:** Revisit if local history, large journals, or offline datasets become part of the product.

### Authenticated server-side persistence

- **Benefits:** Cross-device sync, server-side ownership, backups, collaboration potential.
- **Drawbacks:** Requires an explicit identity provider, database choice, authorization model, migrations, retention policy, and operational backup/restore responsibilities.
- **Assessment:** Correct future direction for multi-device and shared workspaces, but unsafe to improvise before identity and storage ownership are defined.

## Consequences and limitations

- State survives page reloads in the same browser profile when browser storage is available.
- Data is not synchronized across browsers, devices, or users.
- Clearing site data or using private browsing may remove or prevent persistence.
- Browser storage is not a secure vault and must never contain secrets.
- The application reports when browser storage is unavailable.
- Server-side alerts and any feature requiring reliable background execution cannot use this local store as their source of truth.

## Revisit when

- Authentication and account ownership are introduced.
- Users require cross-device workspace synchronization.
- Persistent alerts, collaboration, backup, or server-side audit history are implemented.
- The local data volume exceeds the bounded storage model.
