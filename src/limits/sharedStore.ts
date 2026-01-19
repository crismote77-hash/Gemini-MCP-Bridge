import { createClient } from "redis";
import type { Logger } from "../logger.js";

type RedisClient = ReturnType<typeof createClient>;

export type SharedLimitStore = {
  client: RedisClient;
  keyPrefix: string;
  close: () => Promise<void>;
};

export class RedisConnectionError extends Error {
  name = "RedisConnectionError";
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "REDACTED";
    return parsed.toString();
  } catch {
    return url.replace(/\/\/([^@]+)@/g, "//REDACTED@");
  }
}

export async function createSharedLimitStore(opts: {
  enabled: boolean;
  redisUrl: string;
  keyPrefix: string;
  logger: Logger;
  connectTimeoutMs?: number;
}): Promise<SharedLimitStore | null> {
  if (!opts.enabled) return null;

  const timeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const client = createClient({ url: opts.redisUrl });

  let connectionErrorMessage: string | null = null;
  client.on("error", (error) => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    connectionErrorMessage = errorObj.message;
    opts.logger.error("Redis client error", { error: connectionErrorMessage });
  });

  const connectPromise = client.connect();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new RedisConnectionError(`Redis connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([connectPromise, timeoutPromise]);
  } catch (error) {
    // Attempt to clean up the client if connection failed
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }

    const message = error instanceof Error ? error.message : String(error);
    opts.logger.error("Failed to connect to Redis", {
      url: redactRedisUrl(opts.redisUrl),
      error: message
    });
    throw new RedisConnectionError(`Failed to connect to Redis: ${message}`);
  }

  // Check if there was an error during connection that didn't throw
  if (connectionErrorMessage !== null) {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
    throw new RedisConnectionError(`Redis connection error: ${connectionErrorMessage}`);
  }

  opts.logger.info("Shared limits enabled (Redis)", { url: redactRedisUrl(opts.redisUrl), keyPrefix: opts.keyPrefix });

  return {
    client,
    keyPrefix: opts.keyPrefix,
    close: async () => {
      await client.disconnect();
    },
  };
}
