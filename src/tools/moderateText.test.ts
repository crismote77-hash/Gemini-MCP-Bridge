import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createModerateTextHandler } from "./moderateText.js";

describe("gemini_moderate_text", () => {
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

  it("surfaces prompt/candidate safety metadata", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        promptFeedback: {
          blockReason: "SAFETY",
          safetyRatings: [
            { category: "HARM_CATEGORY_TEST", probability: "LOW" },
          ],
        },
        candidates: [
          {
            finishReason: "STOP",
            safetyRatings: [
              { category: "HARM_CATEGORY_TEST", probability: "LOW" },
            ],
            content: { parts: [{ text: "ok" }] },
          },
        ],
        usageMetadata: { totalTokenCount: 5, promptTokenCount: 4 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createModerateTextHandler(
      deps as unknown as Parameters<typeof createModerateTextHandler>[0],
    );
    const result = await handler({ text: "Hello" });

    expect(result).toHaveProperty("structuredContent");
    const structured = (result as unknown as { structuredContent: unknown })
      .structuredContent as Record<string, unknown>;
    expect(String(structured.promptBlockReason)).toContain("SAFETY");
    expect(structured.candidateFinishReason).toBe("STOP");
    expect(structured.candidateSafetyRatings).toBeTruthy();
  });
});
