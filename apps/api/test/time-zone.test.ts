import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLocalDateTimeToEpochSeconds,
  zonedStartOfDay,
  zonedStartOfMonth,
  zonedStartOfWeek,
} from "../src/market-data/time-zone.js";

test("converts Sydney exchange wall-clock timestamps across standard and daylight time", () => {
  assert.equal(
    parseLocalDateTimeToEpochSeconds("2025-01-01 00:00:00", "Australia/Sydney"),
    Date.parse("2024-12-31T13:00:00.000Z") / 1000,
  );
  assert.equal(
    parseLocalDateTimeToEpochSeconds("2025-07-01 00:00:00", "Australia/Sydney"),
    Date.parse("2025-06-30T14:00:00.000Z") / 1000,
  );
});

test("rejects nonexistent and ambiguous daylight-saving wall-clock times", () => {
  assert.throws(
    () => parseLocalDateTimeToEpochSeconds("2025-10-05 02:30:00", "Australia/Sydney"),
    /does not exist/,
  );
  assert.throws(
    () => parseLocalDateTimeToEpochSeconds("2025-04-06 02:30:00", "Australia/Sydney"),
    /ambiguous/,
  );
});

test("calculates exchange-local daily, Monday-weekly and monthly boundaries", () => {
  const timestamp = Date.parse("2025-01-08T12:00:00.000Z") / 1000;
  assert.equal(
    zonedStartOfDay(timestamp, "Australia/Sydney"),
    Date.parse("2025-01-07T13:00:00.000Z") / 1000,
  );
  assert.equal(
    zonedStartOfWeek(timestamp, "Australia/Sydney"),
    Date.parse("2025-01-05T13:00:00.000Z") / 1000,
  );
  assert.equal(
    zonedStartOfMonth(timestamp, "Australia/Sydney"),
    Date.parse("2024-12-31T13:00:00.000Z") / 1000,
  );
});

test("rejects invalid calendar values and unknown timezones", () => {
  assert.throws(
    () => parseLocalDateTimeToEpochSeconds("2025-02-30 00:00:00", "Australia/Sydney"),
    /invalid calendar values/,
  );
  assert.throws(
    () => parseLocalDateTimeToEpochSeconds("2025-01-01 00:00:00", "Not/A_Timezone"),
  );
});
