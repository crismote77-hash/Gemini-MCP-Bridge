import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createListModelsHandler } from "./listModels.js";

describe("gemini_list_models", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps() {
    const config = {
      model: "gemini-2.5-flash",
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

  it("returns curated models for filtered requests", async () => {
    const deps = createDeps();
    const handler = createListModelsHandler(
      deps as unknown as Parameters<typeof createListModelsHandler>[0],
    );
    const result = await handler({ filter: "vision" });

    expect(deps.rateLimiter.checkOrThrow).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain('"source": "curated"');
    expect(result.content[0]?.text).toContain('"filter": "vision"');
    expect(result.content[0]?.text).toContain("[usage]");
  });

  it("falls back to curated models on API failure", async () => {
    const deps = createDeps();
    vi.spyOn(toolHelpers, "createGeminiClient").mockRejectedValue(
      new Error("boom"),
    );

    const handler = createListModelsHandler(
      deps as unknown as Parameters<typeof createListModelsHandler>[0],
    );
    const result = await handler({ limit: 5 });

    expect(result.content[0]?.text).toContain('"fallback": true');
    expect(result.content[1]?.text).toContain(
      "Warning: Gemini API listModels failed",
    );
  });
});
