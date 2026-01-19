import { describe, expect, it, vi, beforeEach } from "vitest";
import { RateLimiter, RateLimitError } from "./rateLimiter.js";

describe("RateLimiter", () => {
  let mockNowMs: () => number;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000000;
    mockNowMs = vi.fn(() => currentTime);
  });

  it("allows requests under the limit", async () => {
    const limiter = new RateLimiter({ maxPerMinute: 5, nowMs: mockNowMs });

    // Should allow 5 requests
    for (let i = 0; i < 5; i++) {
      await expect(limiter.checkOrThrow()).resolves.toBeUndefined();
    }
  });

  it("throws RateLimitError when limit exceeded", async () => {
    const limiter = new RateLimiter({ maxPerMinute: 3, nowMs: mockNowMs });

    // First 3 should succeed
    await limiter.checkOrThrow();
    await limiter.checkOrThrow();
    await limiter.checkOrThrow();

    // 4th should fail
    await expect(limiter.checkOrThrow()).rejects.toThrow(RateLimitError);
    await expect(limiter.checkOrThrow()).rejects.toThrow(
      "Rate limit exceeded (3/minute).",
    );
  });

  it("allows requests after time window passes", async () => {
    const limiter = new RateLimiter({ maxPerMinute: 2, nowMs: mockNowMs });

    // Use up the limit
    await limiter.checkOrThrow();
    await limiter.checkOrThrow();
    await expect(limiter.checkOrThrow()).rejects.toThrow(RateLimitError);

    // Advance time past the window
    currentTime += 61_000;

    // Should allow again
    await expect(limiter.checkOrThrow()).resolves.toBeUndefined();
  });

  it("prunes old timestamps within the window", async () => {
    const limiter = new RateLimiter({ maxPerMinute: 3, nowMs: mockNowMs });

    // Make 2 requests
    await limiter.checkOrThrow();
    await limiter.checkOrThrow();

    // Advance time 30 seconds (still in window)
    currentTime += 30_000;
    await limiter.checkOrThrow();

    // Advance time another 35 seconds (first 2 should be pruned)
    currentTime += 35_000;

    // Should allow more requests now
    await expect(limiter.checkOrThrow()).resolves.toBeUndefined();
    await expect(limiter.checkOrThrow()).resolves.toBeUndefined();
  });
});
