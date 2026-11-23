import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/env.js";

const baseEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3000",
  WEB_ORIGINS: "http://localhost:5173",
};

test("provider remains disabled unless display licensing is explicitly confirmed", () => {
  const config = loadConfig(baseEnvironment);
  assert.equal(config.TWELVE_DATA_API_KEY, undefined);
  assert.equal(config.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED, false);
});

test("display license confirmation without a provider key fails closed", () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: "true",
    }),
    /API key is required/,
  );
});

test("provider key is accepted only as API process configuration", () => {
  const config = loadConfig({
    ...baseEnvironment,
    TWELVE_DATA_API_KEY: "server-only-test-key",
    TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: "true",
  });
  assert.equal(config.TWELVE_DATA_API_KEY, "server-only-test-key");
  assert.equal(config.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED, true);
});

test("production rejects non-HTTPS browser origins", () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
    }),
    /HTTPS origins only/,
  );
});


test("default local CORS origins include both localhost and loopback Vite addresses", () => {
  const { WEB_ORIGINS: _ignored, ...withoutOrigins } = baseEnvironment;
  const config = loadConfig(withoutOrigins);
  assert.deepEqual(config.WEB_ORIGINS, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
});
