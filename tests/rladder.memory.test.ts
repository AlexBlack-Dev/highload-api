import { describe, expect, it } from "vitest";
import { MemorySlidingWindow } from "../src/lib/rladder/memory.js";

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MemorySlidingWindow", () => {
  it("allows requests up to the limit within one window", async () => {
    const limiter = new MemorySlidingWindow();
    for (let i = 0; i < 5; i++) {
      const d = await limiter.consume("a", 5, 60_000);
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(4 - i);
    }
  });

  it("rejects once the limit is reached", async () => {
    const limiter = new MemorySlidingWindow();
    for (let i = 0; i < 3; i++) {
      const d = await limiter.consume("a", 3, 60_000);
      expect(d.allowed).toBe(true);
    }
    const blocked = await limiter.consume("a", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    const limiter = new MemorySlidingWindow();
    await limiter.consume("a", 2, 100);
    await limiter.consume("a", 2, 100);
    const blocked = await limiter.consume("a", 2, 100);
    expect(blocked.allowed).toBe(false);
    await delay(120);
    const d = await limiter.consume("a", 2, 100);
    expect(d.allowed).toBe(true);
  });

  it("keeps all buckets independent per key", async () => {
    const limiter = new MemorySlidingWindow();
    await limiter.consume("a", 2, 60_000);
    await limiter.consume("a", 2, 60_000);
    const d = await limiter.consume("b", 2, 60_000);
    expect(d.allowed).toBe(true);
    await limiter.consume("b", 2, 60_000);
    const blocked = await limiter.consume("b", 2, 60_000);
    expect(blocked.allowed).toBe(false);
  });

  it("peek does not consume a slot", async () => {
    const limiter = new MemorySlidingWindow();
    await limiter.consume("a", 2, 60_000);
    const peek = await limiter.peek("a", 2, 60_000);
    expect(peek.remaining).toBe(1);
    const consume = await limiter.consume("a", 2, 60_000);
    expect(consume.allowed).toBe(true);
    const blocked = await limiter.consume("a", 2, 60_000);
    expect(blocked.allowed).toBe(false);
  });
});