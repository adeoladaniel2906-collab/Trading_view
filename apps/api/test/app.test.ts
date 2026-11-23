import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_ORIGINS: ["http://localhost:5173"],
  TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: false,
};

test("health endpoint returns service status and security headers", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "ok");
    assert.equal(response.json().service, "market-api");
    assert.match(response.json().timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  } finally {
    await app.close();
  }
});

test("unknown routes return a stable not-found response", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({ method: "GET", url: "/not-a-route" });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: "NOT_FOUND", message: "The requested resource was not found." },
    });
  } finally {
    await app.close();
  }
});

test("CORS does not reflect an untrusted browser origin", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://untrusted.example",
        "access-control-request-method": "GET",
      },
    });
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  } finally {
    await app.close();
  }
});
