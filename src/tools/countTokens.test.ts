import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createCountTokensHandler } from "./countTokens.js";

describe("gemini_count_tokens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps() {
    const config = {
      model: "gemini-2.5-flash",
      limits: { maxInputChars: 10_000 },
    } as unknown as BridgeConfig;

    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    return {
      config,
      logger,
      rateLimiter: { checkOrThrow: vi.fn().mockResolvedValue(undefined) },
      dailyBudget: new DailyTokenBudget({ maxTokensPerDay: 1_000_000 }),
    };
  }

  it("calls countTokens and returns the API response", async () => {
    const deps = createDeps();
    const client = {
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 3 }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createCountTokensHandler(
      deps as unknown as Parameters<typeof createCountTokensHandler>[0],
    );
    const result = await handler({ text: "Hello" });

    expect(client.countTokens).toHaveBeenCalledTimes(1);
    expect(client.countTokens).toHaveBeenCalledWith("gemini-2.5-flash", {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    expect(result.content[0]?.text).toContain('"totalTokens": 3');
    expect(result.content[0]?.text).toContain("[usage]");
  });
});
