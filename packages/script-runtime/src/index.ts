import type { Candle } from "@market/contracts";

export type ScriptValue = number | readonly (number | null)[];
export type ScriptSeries = readonly (number | null)[];
export interface ScriptPlot { readonly name: string; readonly values: ScriptSeries; }
export interface ScriptResult { readonly plots: readonly ScriptPlot[]; readonly barsProcessed: number; readonly operations: number; }
export interface ScriptLimits {
  readonly maxSourceLength: number;
  readonly maxTokens: number;
  readonly maxAstNodes: number;
  readonly maxBars: number;
  readonly maxOperations: number;
  readonly maxPlots: number;
}
export const DEFAULT_SCRIPT_LIMITS: ScriptLimits = Object.freeze({
  maxSourceLength: 16_384, maxTokens: 4_096, maxAstNodes: 2_048,
  maxBars: 10_000, maxOperations: 2_000_000, maxPlots: 32,
});

type TokenKind = "number" | "identifier" | "+" | "-" | "*" | "/" | "(" | ")" | "," | "=" | ";" | "eof";
interface Token { readonly kind: TokenKind; readonly text: string; readonly offset: number; }
type Expr =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "unary"; readonly operator: "+" | "-"; readonly value: Expr }
  | { readonly kind: "binary"; readonly operator: "+" | "-" | "*" | "/"; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Expr[] };
type Statement =
  | { readonly kind: "let"; readonly name: string; readonly value: Expr }
  | { readonly kind: "plot"; readonly name: string; readonly value: Expr };

export class ScriptError extends Error {
  constructor(message: string, readonly offset = 0) { super(message); this.name = "ScriptError"; }
}
function tokenize(source: string, limits: ScriptLimits): Token[] {
  if (source.length > limits.maxSourceLength) throw new ScriptError("Script exceeds the source-size limit.");
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (/\s/.test(c)) { i += 1; continue; }
    const start = i;
    if (/[0-9.]/.test(c)) {
      let text = "";
      while (i < source.length && /[0-9.]/.test(source.charAt(i))) text += source.charAt(i++);
      if (!/^\d+(\.\d+)?$/.test(text)) throw new ScriptError("Invalid numeric literal.", start);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ScriptError("Numeric literal must be finite.", start);
      tokens.push({ kind: "number", text, offset: start });
    } else if (/[A-Za-z_]/.test(c)) {
      let text = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source.charAt(i))) text += source.charAt(i++);
      tokens.push({ kind: "identifier", text, offset: start });
    } else if ("+-*/(),=;".includes(c)) {
      tokens.push({ kind: c as TokenKind, text: c, offset: start }); i += 1;
    } else {
      throw new ScriptError(`Unsupported character "${c}".`, start);
    }
    if (tokens.length > limits.maxTokens) throw new ScriptError("Script exceeds the token limit.", start);
  }
  tokens.push({ kind: "eof", text: "", offset: source.length });
  return tokens;
}
class Parser {
  private index = 0;
  private nodes = 0;
  constructor(private readonly tokens: readonly Token[], private readonly limits: ScriptLimits) {}
  private current(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new ScriptError("Unexpected end of token stream.");
    return token;
  }
  private take(kind: TokenKind): Token {
    const token = this.current();
    if (token.kind !== kind) throw new ScriptError(`Expected "${kind}" but found "${token.text || "end of script"}".`, token.offset);
    this.index += 1; return token;
  }
  private node<T extends Expr>(value: T): T {
    this.nodes += 1;
    if (this.nodes > this.limits.maxAstNodes) throw new ScriptError("Script exceeds the syntax-tree complexity limit.", this.current().offset);
    return value;
  }
  parse(): Statement[] {
    const statements: Statement[] = [];
    while (this.current().kind !== "eof") {
      const keyword = this.take("identifier");
      if (keyword.text === "let") {
        const name = this.take("identifier").text;
        this.take("="); const value = this.expression(); this.take(";");
        statements.push({ kind: "let", name, value });
      } else if (keyword.text === "plot") {
        let name = `Plot ${statements.filter((s) => s.kind === "plot").length + 1}`;
        if (this.current().kind === "identifier" && this.tokens[this.index + 1]?.kind === "=") {
          name = this.take("identifier").text; this.take("=");
        }
        const value = this.expression(); this.take(";");
        statements.push({ kind: "plot", name, value });
      } else {
        throw new ScriptError("Only let and plot statements are supported.", keyword.offset);
      }
      if (statements.length > this.limits.maxPlots + 128) throw new ScriptError("Too many statements.");
    }
    if (!statements.some((s) => s.kind === "plot")) throw new ScriptError("A script must contain at least one plot.");
    return statements;
  }
  private expression(minPrecedence = 0): Expr {
    let left = this.prefix();
    const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
    while ((precedence[this.current().kind] ?? -1) >= minPrecedence) {
      const operator = this.current().kind as "+" | "-" | "*" | "/";
      const p = precedence[operator] ?? 0; this.index += 1;
      const right = this.expression(p + 1);
      left = this.node({ kind: "binary", operator, left, right });
    }
    return left;
  }
  private prefix(): Expr {
    const token = this.current();
    if (token.kind === "number") { this.index += 1; return this.node({ kind: "number", value: Number(token.text) }); }
    if (token.kind === "+" || token.kind === "-") {
      this.index += 1; return this.node({ kind: "unary", operator: token.kind, value: this.expression(3) });
    }
    if (token.kind === "(") { this.index += 1; const value = this.expression(); this.take(")"); return value; }
    if (token.kind === "identifier") {
      this.index += 1;
      if (this.current().kind !== "(") return this.node({ kind: "variable", name: token.text });
      this.index += 1; const args: Expr[] = [];
      while (this.current().kind !== ")" && this.current().kind !== "eof") {
        args.push(this.expression());
        if (this.current().kind !== ",") break;
        this.index += 1;
      }
      this.take(")");
      return this.node({ kind: "call", name: token.text, args });
    }
    throw new ScriptError("Expected a number, variable, function call, or parenthesized expression.", token.offset);
  }
}
const BUILTINS = new Set(["sma", "ema", "abs", "min", "max"]);
function validateExpression(expr: Expr, variables: Set<string>): void {
  if (expr.kind === "number") return;
  if (expr.kind === "variable") {
    if (!variables.has(expr.name) && !["open", "high", "low", "close", "volume"].includes(expr.name)) {
      throw new ScriptError(`Unknown variable "${expr.name}".`);
    }
    return;
  }
  if (expr.kind === "unary") { validateExpression(expr.value, variables); return; }
  if (expr.kind === "binary") { validateExpression(expr.left, variables); validateExpression(expr.right, variables); return; }
  if (!BUILTINS.has(expr.name)) throw new ScriptError(`Function "${expr.name}" is not allowed.`);
  const expected = expr.name === "abs" ? 1 : expr.name === "min" || expr.name === "max" ? 2 : 2;
  if (expr.args.length !== expected) throw new ScriptError(`${expr.name} expects ${expected} argument(s).`);
  for (const arg of expr.args) validateExpression(arg, variables);
}
export function parseScript(source: string, limits: ScriptLimits = DEFAULT_SCRIPT_LIMITS): readonly Statement[] {
  const statements = new Parser(tokenize(source, limits), limits).parse();
  const variables = new Set(["open", "high", "low", "close", "volume"]);
  for (const statement of statements) {
    validateExpression(statement.value, variables);
    if (statement.kind === "let") {
      if (variables.has(statement.name)) throw new ScriptError(`Cannot redeclare "${statement.name}".`);
      variables.add(statement.name);
    }
  }
  return statements;
}
function series(values: ScriptValue, length: number): ScriptSeries {
  return typeof values === "number" ? Array.from({ length }, () => values) : values;
}
function evaluate(expr: Expr, env: Map<string, ScriptValue>, bars: number, budget: { used: number; max: number }): ScriptValue {
  budget.used += bars;
  if (budget.used > budget.max) throw new ScriptError("Execution operation budget exceeded.");
  if (expr.kind === "number") return expr.value;
  if (expr.kind === "variable") {
    const value = env.get(expr.name);
    if (value === undefined) throw new ScriptError(`Variable "${expr.name}" is unavailable.`);
    return value;
  }
  if (expr.kind === "unary") {
    const value = evaluate(expr.value, env, bars, budget);
    return typeof value === "number" ? (expr.operator === "-" ? -value : value)
      : value.map((v) => v === null ? null : expr.operator === "-" ? -v : v);
  }
  if (expr.kind === "binary") {
    const left = evaluate(expr.left, env, bars, budget), right = evaluate(expr.right, env, bars, budget);
    const a = series(left, bars), b = series(right, bars);
    return a.map((x, i) => {
      const y = b[i]; if (x === null || y === null || y === undefined) return null;
      if (expr.operator === "/" && y === 0) return null;
      switch (expr.operator) { case "+": return x + y; case "-": return x - y; case "*": return x * y; default: return x / y; }
    });
  }
  const args = expr.args.map((arg) => evaluate(arg, env, bars, budget));
  const first = args[0];
  if (first === undefined) throw new ScriptError("Missing function argument.");
  if (expr.name === "abs") {
    return typeof first === "number" ? Math.abs(first) : first.map((x) => x === null ? null : Math.abs(x));
  }
  if (expr.name === "min" || expr.name === "max") {
    const second = args[1];
    if (second === undefined) throw new ScriptError("Missing function argument.");
    const a = series(first, bars), b = series(second, bars);
    return a.map((x, i) => {
      const y = b[i];
      if (x === null || y === null || y === undefined) return null;
      return expr.name === "min" ? Math.min(x, y) : Math.max(x, y);
    });
  }
  const second = args[1];
  if (second === undefined) throw new ScriptError("Missing function argument.");
  const input = series(first, bars), periodValue = second;
  if (typeof periodValue !== "number" || !Number.isInteger(periodValue) || periodValue < 1 || periodValue > 500) {
    throw new ScriptError(`${expr.name} period must be an integer between 1 and 500.`);
  }
  if (expr.name === "sma") {
    let sum = 0;
    let missing = 0;
    const result: (number | null)[] = [];
    for (let i = 0; i < bars; i += 1) {
      const value = input[i];
      if (value === null || value === undefined) missing += 1;
      else sum += value;
      if (i >= periodValue) {
        const expired = input[i - periodValue];
        if (expired === null || expired === undefined) missing -= 1;
        else sum -= expired;
      }
      result.push(i + 1 >= periodValue && missing === 0 ? sum / periodValue : null);
    }
    return result;
  }
  const result: (number | null)[] = []; let previous: number | null = null; let seed: number[] = [];
  for (const value of input) {
    if (value === null) { result.push(null); previous = null; seed = []; continue; }
    if (previous === null) {
      seed.push(value);
      if (seed.length < periodValue) { result.push(null); continue; }
      previous = seed.reduce((total, item) => total + item, 0) / periodValue;
      result.push(previous); seed = [];
    } else {
      previous = (value * (2 / (periodValue + 1))) + (previous * (1 - (2 / (periodValue + 1))));
      result.push(previous);
    }
  }
  return result;
}
export function executeScript(source: string, candles: readonly Candle[], limits: ScriptLimits = DEFAULT_SCRIPT_LIMITS): ScriptResult {
  if (candles.length > limits.maxBars) throw new ScriptError("Input candle count exceeds the execution limit.");
  const statements = parseScript(source, limits);
  const env = new Map<string, ScriptValue>([
    ["open", candles.map((c) => c.open)], ["high", candles.map((c) => c.high)],
    ["low", candles.map((c) => c.low)], ["close", candles.map((c) => c.close)],
  ]);
  if (candles.every((c) => c.volume !== undefined)) env.set("volume", candles.map((c) => c.volume ?? null));
  const budget = { used: 0, max: limits.maxOperations };
  const plots: ScriptPlot[] = [];
  for (const statement of statements) {
    const value = evaluate(statement.value, env, candles.length, budget);
    if (statement.kind === "let") env.set(statement.name, value);
    else {
      if (plots.length >= limits.maxPlots) throw new ScriptError("Script exceeds the plot limit.");
      plots.push({ name: statement.name, values: series(value, candles.length) });
    }
  }
  return { plots, barsProcessed: candles.length, operations: budget.used };
}
