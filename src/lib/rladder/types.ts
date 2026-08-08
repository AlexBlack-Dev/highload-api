export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  /**
   * Atomically records a request against `key` with a sliding window of
   * `windowMs` and a limit of `limit` requests per window.
   */
  consume(key: string, limit: number, windowMs: number): Promise<RateDecision>;
  /**
   * Read-only variant: computes the decision without consuming a slot.
   * Optional — not every store implementation can peek cheaply.
   */
  peek?(key: string, limit: number, windowMs: number): Promise<RateDecision>;
}

export function decisionAllowed(allowed: boolean, remaining: number, retryAfterMs: number): RateDecision {
  return { allowed, remaining, retryAfterMs };
}