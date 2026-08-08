import type { RateDecision, RateLimiter } from "./types.js";

interface Bucket {
  windowStart: number;
  currentCount: number;
  previousCount: number;
}

/**
 * Sliding-window counter in two buckets (current + previous), as described
 * in Figma's "An alternative approach to rate limiting". O(1) per request,
 * bounded memory — each key keeps a single fixed-size struct.
 */
export class MemorySlidingWindow implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxKeys = 1_000_000) {}

  consume(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.maybeEvict(now);
      bucket = { windowStart: now, currentCount: 0, previousCount: 0 };
      this.buckets.set(key, bucket);
    }

    if (now - bucket.windowStart >= windowMs) {
      // the trailing window fully expired: no residual weight
      bucket.previousCount = 0;
      bucket.currentCount = 0;
      bucket.windowStart = now;
    }

    const elapsedRatio = (now - bucket.windowStart) / windowMs;
    const projected = Math.floor(
      bucket.previousCount * (1 - elapsedRatio) + bucket.currentCount,
    );

    if (projected >= limit) {
      const retryAfterMs = Math.max(1, windowMs - (now - bucket.windowStart));
      return Promise.resolve({ allowed: false, remaining: 0, retryAfterMs });
    }

    bucket.currentCount += 1;
    return Promise.resolve({
      allowed: true,
      remaining: Math.max(0, limit - projected - 1),
      retryAfterMs: 0,
    });
  }

  get size(): number {
    return this.buckets.size;
  }

  peek(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return Promise.resolve({ allowed: true, remaining: limit, retryAfterMs: 0 });
    }
    const elapsed = now - bucket.windowStart;
    let effective = bucket;
    if (elapsed >= windowMs) {
      effective = { windowStart: now, currentCount: 0, previousCount: 0 };
    }
    const projected = Math.floor(
      effective.previousCount * (1 - elapsed / windowMs) + effective.currentCount,
    );
    const allowed = projected < limit;
    return Promise.resolve({
      allowed,
      remaining: allowed ? limit - projected : 0,
      retryAfterMs: allowed ? 0 : Math.max(1, windowMs - elapsed),
    });
  }

  private maybeEvict(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    let oldestKey: string | undefined;
    let oldestStart = Number.POSITIVE_INFINITY;
    for (const [k, b] of this.buckets) {
      if (now - b.windowStart > 60_000) {
        this.buckets.delete(k);
        if (this.buckets.size < this.maxKeys) return;
      } else if (b.windowStart < oldestStart) {
        oldestStart = b.windowStart;
        oldestKey = k;
      }
    }
    if (oldestKey && this.buckets.size >= this.maxKeys) {
      this.buckets.delete(oldestKey);
    }
  }
}