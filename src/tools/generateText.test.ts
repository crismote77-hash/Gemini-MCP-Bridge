import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createGenerateTextHandler } from "./generateText.js";

describe("gemini_generate_text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps(opts: { debug?: boolean } = {}) {
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
      logging: { debug: Boolean(opts.debug) },
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
      conversationStore: {
        toRequestContents: vi.fn().mockReturnValue([]),
        append: vi.fn(),
      },
    };
  }

  it("returns an error with diagnostics when the API returns no text", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { totalTokenCount: 59, promptTokenCount: 59 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(client as any);

    const handler = createGenerateTextHandler(deps as any);
    const result = await handler({ prompt: "Hello", maxTokens: 50 });

    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("content");
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("No text returned by model");
    expect(result.content[0]?.text).toContain("blockReason=SAFETY");
    expect(result.content[0]?.text).toContain("[usage]");
  });
});

