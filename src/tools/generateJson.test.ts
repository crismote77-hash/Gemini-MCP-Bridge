import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { ConversationStore } from "../services/conversationStore.js";
import { createGenerateJsonHandler } from "./generateJson.js";

describe("gemini_generate_json", () => {
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
      conversationStore: new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10_000,
      }),
    };
  }

  it("returns an error when the model output is not valid JSON", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          { content: { parts: [{ text: "not json" }] }, finishReason: "STOP" },
        ],
        usageMetadata: { totalTokenCount: 10, promptTokenCount: 9 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createGenerateJsonHandler(
      deps as unknown as Parameters<typeof createGenerateJsonHandler>[0],
    );
    const result = await handler({ prompt: "Return JSON" });

    expect(result).toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain("invalid JSON");
  });

  it("returns structuredContent for valid JSON (code fences allowed)", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: '```json\n{"a":1}\n```' }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 10, promptTokenCount: 9 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createGenerateJsonHandler(
      deps as unknown as Parameters<typeof createGenerateJsonHandler>[0],
    );
    const result = await handler({ prompt: "Return JSON" });

    expect(result).toHaveProperty("structuredContent");
    expect(
      (result as unknown as { structuredContent: unknown }).structuredContent,
    ).toEqual({ a: 1 });
  });

  it("unwraps jsonSchema.schema for compatibility", async () => {
    const deps = createDeps();
    const client = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: '{"a":1}' }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 10, promptTokenCount: 9 },
      }),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createGenerateJsonHandler(
      deps as unknown as Parameters<typeof createGenerateJsonHandler>[0],
    );
    const innerSchema = {
      type: "object",
      properties: { a: { type: "number" } },
      required: ["a"],
    };
    await handler({
      prompt: "Return JSON",
      jsonSchema: { name: "Example", schema: innerSchema, strict: true },
    });

    expect(client.generateContent).toHaveBeenCalledTimes(1);
    const requestBody = (
      client.generateContent as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[1] as
      | { generationConfig?: Record<string, unknown> }
      | undefined;
    expect(requestBody?.generationConfig?.response_json_schema).toEqual(
      innerSchema,
    );
  });
});
