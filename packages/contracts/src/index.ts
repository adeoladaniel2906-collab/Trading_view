import * as z from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("market-api"),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
