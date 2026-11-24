import { Worker } from "node:worker_threads";
import type { Candle } from "@market/contracts";
import { DEFAULT_SCRIPT_LIMITS, ScriptError, type ScriptLimits, type ScriptResult } from "./index.js";

export interface IsolatedExecutionOptions {
  readonly timeoutMs?: number;
  readonly limits?: ScriptLimits;
}
interface WorkerResponse { readonly ok: boolean; readonly result?: ScriptResult; readonly error?: string; }

/** Executes the restricted DSL in a resource-limited worker. The input is interpreted data, never JavaScript source. */
export function executeScriptIsolated(
  source: string,
  candles: readonly Candle[],
  options: IsolatedExecutionOptions = {},
): Promise<ScriptResult> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 2_000, 25), 10_000);
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    workerData: { source, candles, limits: options.limits ?? DEFAULT_SCRIPT_LIMITS },
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: ScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new ScriptError("Script worker returned no result."));
    };
    const timer = setTimeout(() => finish(new ScriptError("Script execution timed out.")), timeoutMs);
    worker.once("message", (response: WorkerResponse) => {
      if (!response.ok) finish(new ScriptError(response.error ?? "Script execution failed."));
      else if (response.result) finish(undefined, response.result);
      else finish(new ScriptError("Script worker returned an invalid response."));
    });
    worker.once("error", (error) => finish(new ScriptError(`Script worker failed: ${error.message}`)));
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) finish(new ScriptError(`Script worker exited with code ${code}.`));
    });
  });
}
