import { describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { createCodeReviewHandler } from "./codeReview.js";
import type { RootsExtra } from "../utils/filesystemAccess.js";

describe("gemini_code_review", () => {
  it("returns an error when filesystem access is disabled", async () => {
    const config = {
      model: "gemini-2.5-flash",
      generation: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
      limits: {
        maxTokensPerRequest: 2048,
        maxInputChars: 10_000,
      },
      filesystem: {
        mode: "off",
        allowWrite: false,
        allowSystem: false,
        followSymlinks: true,
        maxFiles: 25,
        maxFileBytes: 200_000,
        maxTotalBytes: 2_000_000,
        allowedExtensions: [".ts"],
        denyPatterns: ["**/.git/**"],
      },
      logging: { debug: false },
    } as unknown as BridgeConfig;

    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const deps = {
      config,
      logger,
      rateLimiter: { checkOrThrow: vi.fn().mockResolvedValue(undefined) },
      dailyBudget: new DailyTokenBudget({ maxTokensPerDay: 1_000_000 }),
    };

    const handler = createCodeReviewHandler(deps as never);
    const extra = {
      requestId: "test",
      signal: new AbortController().signal,
      sendNotification: vi.fn(async () => undefined),
      sendRequest: vi.fn(),
    } as unknown as RootsExtra;

    const result = await handler({ request: "Review this repo" }, extra);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Filesystem access is disabled");
  });
});
