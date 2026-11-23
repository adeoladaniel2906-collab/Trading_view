export const TWELVE_DATA_FOREX_TIME_ZONE = "Australia/Sydney";

export interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsAt(epochMilliseconds: number, formatter: Intl.DateTimeFormat): Omit<ZonedDateParts, "weekday"> {
  const values = new Map(formatter.formatToParts(new Date(epochMilliseconds)).map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) {
    throw new RangeError("Unable to resolve timezone date components");
  }
  return { year, month, day, hour, minute, second };
}

function sameLocalTime(
  actual: Omit<ZonedDateParts, "weekday">,
  expected: Omit<ZonedDateParts, "weekday">,
): boolean {
  return actual.year === expected.year && actual.month === expected.month &&
    actual.day === expected.day && actual.hour === expected.hour &&
    actual.minute === expected.minute && actual.second === expected.second;
}

function offsetAt(epochMilliseconds: number, formatter: Intl.DateTimeFormat): number {
  const wholeSecond = Math.floor(epochMilliseconds / 1_000) * 1_000;
  const local = partsAt(wholeSecond, formatter);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - wholeSecond;
}

/**
 * Convert a timezone-free provider wall-clock timestamp into a UTC Unix timestamp.
 * Ambiguous and nonexistent local times are rejected rather than guessed across DST.
 */
export function parseLocalDateTimeToEpochSeconds(value: string, timeZone: string): number {
  if (typeof value !== "string" || value.length > 32) {
    throw new RangeError("Local timestamp is invalid");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value);
  if (!match) throw new RangeError("Local timestamp format is invalid");

  const expected = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0"));
  const localMilliseconds = Date.UTC(
    expected.year, expected.month - 1, expected.day,
    expected.hour, expected.minute, expected.second, milliseconds,
  );
  const check = new Date(localMilliseconds);
  if (check.getUTCFullYear() !== expected.year ||
    check.getUTCMonth() + 1 !== expected.month ||
    check.getUTCDate() !== expected.day ||
    check.getUTCHours() !== expected.hour ||
    check.getUTCMinutes() !== expected.minute ||
    check.getUTCSeconds() !== expected.second ||
    expected.year < 100 || expected.month < 1 || expected.month > 12 ||
    expected.hour > 23 || expected.minute > 59 || expected.second > 59) {
    throw new RangeError("Local timestamp contains invalid calendar values");
  }

  const formatter = formatterFor(timeZone);
  const offsets = new Set([
    offsetAt(localMilliseconds - 36 * 60 * 60 * 1_000, formatter),
    offsetAt(localMilliseconds, formatter),
    offsetAt(localMilliseconds + 36 * 60 * 60 * 1_000, formatter),
  ]);
  const candidates = [...offsets]
    .map((offset) => localMilliseconds - offset)
    .filter((candidate) =>
      candidate % 1_000 === milliseconds &&
      sameLocalTime(partsAt(candidate, formatter), expected));

  if (candidates.length !== 1) {
    throw new RangeError(candidates.length === 0
      ? "Local timestamp does not exist in the supplied timezone"
      : "Local timestamp is ambiguous in the supplied timezone");
  }
  const result = candidates[0];
  const unixSeconds = result === undefined ? Number.NaN : Math.floor(result / 1_000);
  if (!Number.isSafeInteger(unixSeconds)) {
    throw new RangeError("Local timestamp is outside the supported Unix timestamp range");
  }
  return unixSeconds;
}

export function zonedDateParts(epochSeconds: number, timeZone: string): ZonedDateParts {
  if (!Number.isFinite(epochSeconds)) throw new RangeError("Timestamp must be finite");
  const local = partsAt(epochSeconds * 1_000, formatterFor(timeZone));
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  return { ...local, weekday };
}

export function zonedStartOfDay(epochSeconds: number, timeZone: string): number {
  const local = zonedDateParts(epochSeconds, timeZone);
  return parseLocalDateTimeToEpochSeconds(
    `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")} 00:00:00`,
    timeZone,
  );
}

export function zonedStartOfWeek(epochSeconds: number, timeZone: string): number {
  const local = zonedDateParts(epochSeconds, timeZone);
  const daysSinceMonday = (local.weekday + 6) % 7;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceMonday));
  const date = monday.toISOString().slice(0, 10);
  return parseLocalDateTimeToEpochSeconds(date + " 00:00:00", timeZone);
}

export function zonedStartOfMonth(epochSeconds: number, timeZone: string): number {
  const local = zonedDateParts(epochSeconds, timeZone);
  const date = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-01 00:00:00`;
  return parseLocalDateTimeToEpochSeconds(date, timeZone);
}
