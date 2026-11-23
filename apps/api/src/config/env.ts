import * as z from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
    .pipe(
      z.array(
        z.url().refine((value) => {
          const parsed = new URL(value);
          return parsed.origin === value && !parsed.username && !parsed.password;
        }, "Origins must not contain paths, credentials, or query strings."),
      ).min(1),
    ),
  TWELVE_DATA_API_KEY: z.string().trim().min(1).optional(),
  TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => (issue.path.join(".") || "environment") + ": " + issue.message)
      .join("; ");
    throw new Error("Invalid application configuration: " + issues);
  }

  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.WEB_ORIGINS.some((origin) => !origin.startsWith("https://"))
  ) {
    throw new Error("Production WEB_ORIGINS must contain HTTPS origins only.");
  }

  if (parsed.data.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED && !parsed.data.TWELVE_DATA_API_KEY) {
    throw new Error("A Twelve Data API key is required when display access is enabled.");
  }
  return parsed.data;
}
