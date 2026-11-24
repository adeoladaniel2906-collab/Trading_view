import { parentPort, workerData } from "node:worker_threads";
import type { Candle } from "@market/contracts";
import { executeScript, type ScriptLimits } from "./index.js";

interface WorkerInput {
  readonly source: string;
  readonly candles: readonly Candle[];
  readonly limits?: ScriptLimits;
}
if (!parentPort) throw new Error("Script worker must run inside a worker thread.");
try {
  const input = workerData as WorkerInput;
  const result = executeScript(input.source, input.candles, input.limits);
  parentPort.postMessage({ ok: true, result });
} catch (cause) {
  parentPort.postMessage({
    ok: false,
    error: cause instanceof Error ? cause.message : "Script execution failed.",
  });
}
