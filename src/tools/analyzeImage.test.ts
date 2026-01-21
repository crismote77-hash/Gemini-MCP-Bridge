import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createAnalyzeImageHandler } from "./analyzeImage.js";

describe("gemini_analyze_image", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps() {
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
      images: {
        maxBytes: 100_000,
        allowedMimeTypes: ["image/png", "image/jpeg"],
      },
      logging: { debug: false },
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

  it("requires an image input", async () => {
    const deps = createDeps();
    const handler = createAnalyzeImageHandler(
      deps as unknown as Parameters<typeof createAnalyzeImageHandler>[0],
    );
    const result = await handler({ prompt: "Describe this." });

    expect(result).toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain(
      "Provide imageUrl or imageBase64",
    );
  });

  it("requires mimeType for base64 input", async () => {
    const deps = createDeps();
    const handler = createAnalyzeImageHandler(
      deps as unknown as Parameters<typeof createAnalyzeImageHandler>[0],
    );
    const result = await handler({
      prompt: "Describe this.",
      imageBase64: "aGVsbG8=",
    });

    expect(result).toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain("Missing mimeType for image");
  });

  it("returns model text for base64 input", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: "Image looks great." }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 12, promptTokenCount: 5 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createAnalyzeImageHandler(
      deps as unknown as Parameters<typeof createAnalyzeImageHandler>[0],
    );
    const result = await handler({
      prompt: "Describe this.",
      imageBase64: Buffer.from("hello").toString("base64"),
      mimeType: "image/png",
    });

    expect(client.generateContent).toHaveBeenCalledTimes(1);
    const requestBody = (
      client.generateContent as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[1] as
      | { contents?: Array<{ parts?: Array<{ inlineData?: unknown }> }> }
      | undefined;
    const inlineData = requestBody?.contents?.[0]?.parts?.[1]?.inlineData as
      | { mimeType?: string }
      | undefined;
    expect(inlineData?.mimeType).toBe("image/png");

    expect(result).not.toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain("Image looks great.");
    expect(result.content[0]?.text).toContain("[usage]");
  });
});
