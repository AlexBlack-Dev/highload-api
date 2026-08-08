import { Redis } from "ioredis";
import type { RateDecision, RateLimiter } from "./types.js";

/**
 * Tightly-packed sliding-window bucket during peak bursts to keep zset sizes
 * small: when consumers send N requests at the same millisecond we still
 * store one member per request. The Lua script below uses a single
 * ZREMRANGEBYSCORE + ZCARD + ZADD round-trip.
 */
const LUA_SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local uid = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, uid)
  redis.call('PEXPIRE', key, windowMs * 2)
  return {1, count, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfter
if #oldest >= 2 then
  retryAfter = tonumber(oldest[2]) + windowMs - now
else
  retryAfter = windowMs
end
if retryAfter < 1 then retryAfter = 1 end
return {0, 0, retryAfter}
`;

const LUA_PEEK = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
if count < limit then
  return {1, count, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfter
if #oldest >= 2 then
  retryAfter = tonumber(oldest[2]) + windowMs - now
else
  retryAfter = windowMs
end
if retryAfter < 1 then retryAfter = 1 end
return {0, 0, retryAfter}
`;

/**
 * Distributed sliding window backed by a Redis zset, executed atomically in
 * Lua. Suitable for multi-node deployments sharing one Redis instance.
 */
export class RedisSlidingWindow implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly uidSeed: string = Math.random().toString(36).slice(2),
    private readonly uidCounter: { next: () => number } = { next: createCounter() },
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const result = (await this.redis.eval(
      LUA_SLIDING_WINDOW,
      1,
      `rl:${key}`,
      String(Date.now()),
      String(windowMs),
      String(limit),
      `${this.uidSeed}:${this.uidCounter.next()}`,
    )) as unknown[];
    const allowed = Number(result[0]) === 1;
    const remaining = Number(result[1]);
    const retryAfterMs = Number(result[2]);
    return { allowed, remaining, retryAfterMs };
  }

  async peek(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const result = (await this.redis.eval(
      LUA_PEEK,
      1,
      `rl:${key}`,
      String(Date.now()),
      String(windowMs),
      String(limit),
    )) as unknown[];
    const allowed = Number(result[0]) === 1;
    const remaining = Number(result[1]);
    const retryAfterMs = Number(result[2]);
    return { allowed, remaining, retryAfterMs };
  }
}

function createCounter(): () => number {
  let n = 0;
  return () => (n += 1);
}