export class RateLimitError extends Error {
  name = "RateLimitError";
}

import { randomUUID } from "node:crypto";
import type { SharedLimitStore } from "./sharedStore.js";

type RateLimitEvalResult = [allowed: number, count: number];

function isRateLimitEvalResult(value: unknown): value is RateLimitEvalResult {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

export class RateLimiter {
  private readonly maxPerMinute: number;
  private readonly nowMs: () => number;
  private readonly timestamps: number[] = [];
  private readonly sharedStore?: SharedLimitStore;
  private static readonly SHARED_SCRIPT = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local cutoff = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local ttl = tonumber(ARGV[4])
    local member = ARGV[5]

    redis.call('zremrangebyscore', key, 0, cutoff)
    local count = redis.call('zcard', key)
    if count >= limit then
      return {0, count}
    end
    redis.call('zadd', key, now, member)
    redis.call('expire', key, ttl)
    return {1, count + 1}
  `;

  constructor(opts: {
    maxPerMinute: number;
    nowMs?: () => number;
    sharedStore?: SharedLimitStore;
  }) {
    this.maxPerMinute = opts.maxPerMinute;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.sharedStore = opts.sharedStore;
  }

  async checkOrThrow(): Promise<void> {
    if (this.sharedStore) {
      await this.checkShared();
      return;
    }

    const now = this.nowMs();
    const cutoff = now - 60_000;

    // Use filter() instead of repeated shift() for efficiency
    // This also serves as a safety valve - even if timestamps somehow grow,
    // we efficiently prune them in one pass
    const validTimestamps = this.timestamps.filter((ts) => ts > cutoff);

    // Hard cap on array size to prevent memory leaks in edge cases
    const maxArraySize = this.maxPerMinute * 2;
    if (validTimestamps.length > maxArraySize) {
      // Keep only the most recent timestamps
      validTimestamps.splice(0, validTimestamps.length - maxArraySize);
    }

    // Replace the array contents
    this.timestamps.length = 0;
    this.timestamps.push(...validTimestamps);

    if (this.timestamps.length >= this.maxPerMinute) {
      throw new RateLimitError(
        `Rate limit exceeded (${this.maxPerMinute}/minute).`,
      );
    }
    this.timestamps.push(now);
  }

  private async checkShared(): Promise<void> {
    if (!this.sharedStore) return;
    const now = this.nowMs();
    const cutoff = now - 60_000;
    const key = `${this.sharedStore.keyPrefix}:rate`;
    const member = `${now}:${randomUUID()}`;
    // Note: client.eval is the Redis EVAL command for Lua scripts, not JavaScript eval()
    const result: unknown = await this.sharedStore.client.eval(
      RateLimiter.SHARED_SCRIPT,
      {
        keys: [key],
        arguments: [
          String(now),
          String(cutoff),
          String(this.maxPerMinute),
          "120",
          member,
        ],
      },
    );

    if (!isRateLimitEvalResult(result)) {
      throw new Error(
        `Unexpected Redis rate limit response format: expected [number, number], got ${JSON.stringify(result)}`,
      );
    }

    const [allowed, count] = result;
    if (!allowed) {
      throw new RateLimitError(
        `Rate limit exceeded (${count}/${this.maxPerMinute}/minute).`,
      );
    }
  }
}
