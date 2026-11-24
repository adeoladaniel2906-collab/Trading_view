# Phase C: constrained script runtime

## Purpose

Provide a deterministic, versioned starting point for chart scripts without executing user-authored JavaScript. The runtime is provider-neutral and consumes validated canonical candles.

## Language v0.1

A script is a sequence of statements terminated by semicolons:

```text
let fast = ema(close, 12);
let slow = ema(close, 26);
plot momentum = fast - slow;
plot baseline = sma(close, 20);
```

Supported inputs: `open`, `high`, `low`, `close`, and `volume` only when every input candle supplies volume.

Supported operators: unary `+` / `-`, and binary `+`, `-`, `*`, `/` with standard precedence and parentheses.

Supported built-ins:
- `sma(series, period)`
- `ema(series, period)`
- `abs(value)`
- `min(left, right)`
- `max(left, right)`

Periods must be integer values from 1 through 500. Warm-up values are null. Division by zero produces null rather than Infinity. Input candles are read-only.

## Security boundary

The parser accepts a narrow grammar. It does not accept JavaScript, property access, loops, imports, network calls, file access, environment access, or arbitrary function names. The interpreter uses an allowlist and does not use eval or Function constructors.

The Node entrypoint runs the interpreter in a worker thread with explicit memory and stack limits and a hard wall-clock timeout. This is a resource-containment layer for the restricted DSL, not a hardened operating-system sandbox for arbitrary native or JavaScript code. The DSL is not arbitrary code.

## Limits

Default limits:
- source: 16 KiB
- tokens: 4,096
- AST nodes: 2,048
- bars: 10,000
- interpreter operations: 2,000,000
- plots: 32
- worker timeout: 2 seconds by default, bounded to 25 ms–10 seconds

## Explicit exclusions

This is not Pine Script compatibility, not a full IDE, and not yet integrated into a public script editor or strategy endpoint. Those are later tasks. No script can place orders or call a provider.

## Verification required before Phase C exit

- deterministic fixture comparisons for every built-in
- parser fuzzing and malformed-input corpus
- resource-limit and timeout tests
- worker termination tests
- proof of no network/filesystem/environment access through the language surface
- CodeQL, typecheck, unit tests, audit, and production build
