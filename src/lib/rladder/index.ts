import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { AppConfig } from "../../config.js";
import { MemorySlidingWindow } from "./memory.js";
import { RedisSlidingWindow } from "./redis.js";
import type { RateLimiter } from "./types.js";

export interface RateLimiterHandle {
  limiter: RateLimiter;
  close(): Promise<void>;
}

export async function createRateLimiter(
  config: AppConfig,
  log: Logger,
): Promise<RateLimiterHandle> {
  if (config.RATE_STORE === "redis") {
    const url = config.REDIS_URL;
    if (!url) {
      throw new Error("RATE_STORE=redis requires REDIS_URL to be set");
    }
    const redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
    redis.on("error", (err: Error) => {
      log.error({ err }, "redis error");
    });
    await redis.ping();
    log.info({ url: maskRedisUrl(url) }, "rate limiter: redis");
    return {
      limiter: new RedisSlidingWindow(redis),
      close: async () => {
        redis.disconnect();
      },
    };
  }

  log.info("rate limiter: memory");
  const memory = new MemorySlidingWindow();
  return {
    limiter: memory,
    close: async () => undefined,
  };
}

function maskRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(invalid url)";
  }
}