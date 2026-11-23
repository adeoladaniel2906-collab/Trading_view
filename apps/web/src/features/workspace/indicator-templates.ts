import { INDICATOR_CATALOG, type IndicatorId } from "../chart/indicators";
import {
  isValidIndicatorParameters,
  type ChartPanelState,
  type IndicatorParameters,
} from "./workspace-model";
import type { KeyValueStorage } from "./workspace-storage";

export const INDICATOR_TEMPLATE_STORAGE_KEY = "market-workspace.indicator-templates.v1";
export const INDICATOR_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const MAX_INDICATOR_TEMPLATES = 20;
export const MAX_INDICATOR_TEMPLATE_NAME_LENGTH = 40;
export const MAX_INDICATOR_TEMPLATE_STORAGE_CHARS = 100_000;

const INDICATOR_IDS = INDICATOR_CATALOG.map((indicator) => indicator.id);

export interface IndicatorTemplate {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly indicators: Readonly<Record<IndicatorId, boolean>>;
  readonly indicatorParameters: IndicatorParameters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUniqueTemplates(templates: readonly IndicatorTemplate[]): boolean {
  const ids = new Set(templates.map((template) => template.id));
  const names = new Set(templates.map((template) => template.name.toLocaleLowerCase("en-US")));
  return ids.size === templates.length && names.size === templates.length;
}

export function isValidIndicatorTemplate(value: unknown): value is IndicatorTemplate {
  if (!isRecord(value) ||
    typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
    typeof value.name !== "string" ||
    value.name.length < 1 || value.name.length > MAX_INDICATOR_TEMPLATE_NAME_LENGTH ||
    value.name !== value.name.trim() ||
    typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt < 0) {
    return false;
  }
  const indicators = value.indicators;
  if (!isRecord(indicators) ||
    Object.keys(indicators).length !== INDICATOR_IDS.length ||
    INDICATOR_IDS.some((id) => typeof indicators[id] !== "boolean") ||
    Object.keys(indicators).some((id) => !INDICATOR_IDS.includes(id as IndicatorId))) {
    return false;
  }
  return isValidIndicatorParameters(value.indicatorParameters);
}

export function createIndicatorTemplate(
  name: string,
  panel: ChartPanelState,
  id: string,
  now: number,
): IndicatorTemplate {
  const template: IndicatorTemplate = {
    id,
    name: name.trim(),
    createdAt: now,
    indicators: { ...panel.indicators },
    indicatorParameters: { ...panel.indicatorParameters },
  };
  if (!isValidIndicatorTemplate(template)) {
    throw new RangeError("Indicator template name or settings are invalid");
  }
  return template;
}

export function upsertIndicatorTemplate(
  templates: readonly IndicatorTemplate[],
  template: IndicatorTemplate,
): IndicatorTemplate[] {
  if (!isValidIndicatorTemplate(template)) throw new TypeError("Indicator template is invalid");
  const nameConflict = templates.some((item) =>
    item.id !== template.id && item.name.toLocaleLowerCase("en-US") === template.name.toLocaleLowerCase("en-US"));
  if (nameConflict) throw new RangeError("A template with this name already exists");
  const exists = templates.some((item) => item.id === template.id);
  const next = exists
    ? templates.map((item) => item.id === template.id ? template : item)
    : [template, ...templates];
  if (next.length > MAX_INDICATOR_TEMPLATES) {
    throw new RangeError("Indicator template limit reached");
  }
  return next;
}

export function deleteIndicatorTemplate(
  templates: readonly IndicatorTemplate[],
  templateId: string,
): IndicatorTemplate[] {
  return templates.filter((template) => template.id !== templateId);
}

export function applyIndicatorTemplate(
  panel: ChartPanelState,
  template: IndicatorTemplate,
): ChartPanelState {
  if (!isValidIndicatorTemplate(template)) throw new TypeError("Indicator template is invalid");
  return {
    ...panel,
    indicators: { ...template.indicators },
    indicatorParameters: { ...template.indicatorParameters },
  };
}

export function parseIndicatorTemplates(serialized: string | null): IndicatorTemplate[] | null {
  if (!serialized || serialized.length > MAX_INDICATOR_TEMPLATE_STORAGE_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.schemaVersion !== INDICATOR_TEMPLATE_SCHEMA_VERSION ||
      !Array.isArray(parsed.templates) || parsed.templates.length > MAX_INDICATOR_TEMPLATES ||
      !parsed.templates.every(isValidIndicatorTemplate)) return null;
    const templates = parsed.templates as IndicatorTemplate[];
    return isUniqueTemplates(templates) ? templates : null;
  } catch {
    return null;
  }
}

export function readIndicatorTemplates(storage: KeyValueStorage | null): IndicatorTemplate[] {
  if (!storage) return [];
  try {
    return parseIndicatorTemplates(storage.getItem(INDICATOR_TEMPLATE_STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function writeIndicatorTemplates(
  storage: KeyValueStorage | null,
  templates: readonly IndicatorTemplate[],
): boolean {
  if (!storage || templates.length > MAX_INDICATOR_TEMPLATES ||
    !templates.every(isValidIndicatorTemplate) || !isUniqueTemplates(templates)) return false;
  const serialized = JSON.stringify({
    schemaVersion: INDICATOR_TEMPLATE_SCHEMA_VERSION,
    templates,
  });
  if (serialized.length > MAX_INDICATOR_TEMPLATE_STORAGE_CHARS || !parseIndicatorTemplates(serialized)) {
    return false;
  }
  try {
    const existing = storage.getItem(INDICATOR_TEMPLATE_STORAGE_KEY);
    if (existing !== null && !parseIndicatorTemplates(existing)) return false;
    storage.setItem(INDICATOR_TEMPLATE_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
