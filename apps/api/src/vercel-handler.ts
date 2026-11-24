import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app.js";

const appReady = app.ready();

export async function handleVercelRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await appReady;
  const requestUrl = request.url ?? "/";
  request.url = requestUrl.replace(/^\/api(?=\/|\?|$)/, "") || "/";
  app.server.emit("request", request, response);
}
