import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ADMIN_KEY: z.string().min(4).default("dev-admin-key"),
  RATE_STORE: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().optional().default(""),
  DATABASE_URL: z.string().default("sqlite:./data/app.db"),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(100_000).default(600),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}