import assert from "node:assert/strict";
import test from "node:test";
import {
  INDICATOR_TEMPLATE_STORAGE_KEY,
  MAX_INDICATOR_TEMPLATES,
  applyIndicatorTemplate,
  createIndicatorTemplate,
  deleteIndicatorTemplate,
  parseIndicatorTemplates,
  readIndicatorTemplates,
  upsertIndicatorTemplate,
  writeIndicatorTemplates,
  type IndicatorTemplate,
} from "../src/features/workspace/indicator-templates.js";
import {
  createWorkspaceState,
  updatePanelIndicator,
  updatePanelIndicatorParameter,
} from "../src/features/workspace/workspace-model.js";
import type { KeyValueStorage } from "../src/features/workspace/workspace-storage.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function makePanel() {
  const workspace = createWorkspaceState(() => "panel-1");
  let panel = workspace.panels[0]!;
  panel = {
    ...updatePanelIndicator({ ...workspace, panels: [panel] }, "panel-1", "rsi", true).panels[0]!,
  };
  panel = updatePanelIndicatorParameter({ ...workspace, panels: [panel] }, "panel-1", "rsiPeriod", 21)
    .panels[0]!;
  return panel;
}

function makeTemplate(id: string, name: string, now = 1_800_000_000_000) {
  return createIndicatorTemplate(name, makePanel(), id, now);
}

test("creates and applies a template with panel toggles and validated parameters", () => {
  const panel = makePanel();
  const template = createIndicatorTemplate("Momentum", panel, "template-1", 1_800_000_000_000);
  const target = { ...panel, indicators: { ...panel.indicators, rsi: false }, indicatorParameters: {
    ...panel.indicatorParameters,
    rsiPeriod: 14,
  } };
  const applied = applyIndicatorTemplate(target, template);
  assert.equal(applied.indicators.rsi, true);
  assert.equal(applied.indicatorParameters.rsiPeriod, 21);
});

test("template names are trimmed, bounded and unique without case sensitivity", () => {
  const first = makeTemplate("one", "Momentum");
  assert.equal(first.name, "Momentum");
  assert.throws(() => createIndicatorTemplate("   ", makePanel(), "bad", 1), /invalid/);
  assert.throws(() => createIndicatorTemplate("x".repeat(41), makePanel(), "long", 1), /invalid/);
  assert.throws(() => upsertIndicatorTemplate([first], makeTemplate("two", "momentum")), /already exists/);
});

test("upsert replaces by ID, prepends new records and delete removes only the selected ID", () => {
  const first = makeTemplate("one", "Momentum");
  const second = makeTemplate("two", "Trend");
  const inserted = upsertIndicatorTemplate([first], second);
  assert.deepEqual(inserted.map((item) => item.id), ["two", "one"]);
  const replaced = upsertIndicatorTemplate(inserted, { ...second, name: "Trend v2" });
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0]?.name, "Trend v2");
  assert.deepEqual(deleteIndicatorTemplate(replaced, "two").map((item) => item.id), ["one"]);
});

test("template collection enforces its bounded size", () => {
  const templates = Array.from({ length: MAX_INDICATOR_TEMPLATES }, (_, index) =>
    makeTemplate(`template-${index}`, `Template ${index}`));
  assert.throws(() => upsertIndicatorTemplate(
    templates,
    makeTemplate("overflow", "Overflow"),
  ), /limit reached/);
  assert.equal(writeIndicatorTemplates(new MemoryStorage(), [
    ...templates,
    makeTemplate("overflow", "Overflow"),
  ]), false);
});

test("storage round-trips valid templates and preserves unknown future formats", () => {
  const storage = new MemoryStorage();
  const template = makeTemplate("one", "Momentum");
  assert.equal(writeIndicatorTemplates(storage, [template]), true);
  assert.deepEqual(readIndicatorTemplates(storage), [template]);
  assert.equal(parseIndicatorTemplates("{"), null);
  const original = JSON.stringify({ schemaVersion: 99, templates: [] });
  storage.setItem(INDICATOR_TEMPLATE_STORAGE_KEY, original);
  assert.equal(writeIndicatorTemplates(storage, [template]), false);
  assert.equal(storage.getItem(INDICATOR_TEMPLATE_STORAGE_KEY), original);
});

test("parser rejects duplicate IDs, duplicate names and invalid indicator settings", () => {
  const first = makeTemplate("one", "Momentum");
  const duplicateName = makeTemplate("two", "momentum");
  const serialize = (templates: readonly IndicatorTemplate[]) => JSON.stringify({
    schemaVersion: 1,
    templates,
  });
  assert.equal(parseIndicatorTemplates(serialize([first, { ...first, id: "other" }])), null);
  assert.equal(parseIndicatorTemplates(serialize([first, duplicateName])), null);
  assert.equal(parseIndicatorTemplates(serialize([{
    ...first,
    indicatorParameters: { ...first.indicatorParameters, macdFastPeriod: 40 },
  }])), null);
});
