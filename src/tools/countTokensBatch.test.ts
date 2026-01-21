import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createCountTokensBatchHandler } from "./countTokensBatch.js";

describe("gemini_count_tokens_batch", () => {
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

  it("returns best-effort per-item results", async () => {
    const deps = createDeps();
    const countTokens = vi
      .fn()
      .mockResolvedValueOnce({ totalTokens: 3 })
      .mockRejectedValueOnce(new Error("boom"));
    const client = {
      countTokens,
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createCountTokensBatchHandler(
      deps as unknown as Parameters<typeof createCountTokensBatchHandler>[0],
    );
    const result = await handler({ texts: ["Hello", "World"] });

    expect(countTokens).toHaveBeenCalledTimes(2);
    const structured = (result as unknown as { structuredContent: unknown })
      .structuredContent as { results: Array<Record<string, unknown>> };
    expect(structured.results[0]).toMatchObject({
      index: 0,
      ok: true,
      totalTokens: 3,
    });
    expect(structured.results[1]).toMatchObject({
      index: 1,
      ok: false,
    });
  });
});
