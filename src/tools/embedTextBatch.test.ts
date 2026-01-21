import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createEmbedTextBatchHandler } from "./embedTextBatch.js";

describe("gemini_embed_text_batch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps() {
    const config = {
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

  it("uses embedContent on the Developer backend and extracts vectors", async () => {
    const deps = createDeps();
    const embedContent = vi.fn().mockResolvedValue({
      embedding: { values: [1, 2, 3] },
    });
    const predict = vi.fn().mockResolvedValue({ ok: true });
    const client = {
      backend: "developer",
      embedContent,
      predict,
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createEmbedTextBatchHandler(
      deps as unknown as Parameters<typeof createEmbedTextBatchHandler>[0],
    );
    const result = await handler({ texts: ["Hello world"] });

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(predict).not.toHaveBeenCalled();
    const structured = (result as unknown as { structuredContent: unknown })
      .structuredContent as {
      results: Array<{ ok: boolean; vector?: number[] }>;
    };
    expect(structured.results[0]?.ok).toBe(true);
    expect(structured.results[0]?.vector).toEqual([1, 2, 3]);
  });

  it("uses predict on the Vertex backend", async () => {
    const deps = createDeps();
    const embedContent = vi.fn().mockResolvedValue({ ok: true });
    const predict = vi.fn().mockResolvedValue({
      predictions: [{ embeddings: { values: [4, 5] } }],
    });
    const client = {
      backend: "vertex",
      embedContent,
      predict,
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createEmbedTextBatchHandler(
      deps as unknown as Parameters<typeof createEmbedTextBatchHandler>[0],
    );
    const result = await handler({ texts: ["Hello world"] });

    expect(predict).toHaveBeenCalledTimes(1);
    expect(embedContent).not.toHaveBeenCalled();
    const structured = (result as unknown as { structuredContent: unknown })
      .structuredContent as {
      results: Array<{ ok: boolean; vector?: number[] }>;
    };
    expect(structured.results[0]?.ok).toBe(true);
    expect(structured.results[0]?.vector).toEqual([4, 5]);
  });
});
