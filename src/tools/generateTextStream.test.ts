import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { ConversationStore } from "../services/conversationStore.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createGenerateTextStreamHandler } from "./generateTextStream.js";

async function* streamChunks(chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("gemini_generate_text_stream", () => {
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

  it("streams text deltas and updates conversation state", async () => {
    const deps = createDeps();
    const client = {
      streamGenerateContent: vi.fn().mockReturnValue(
        streamChunks([
          {
            candidates: [
              {
                content: { parts: [{ text: "Hello" }] },
                finishReason: "STOP",
              },
            ],
          },
          {
            candidates: [
              {
                content: { parts: [{ text: "Hello world" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { totalTokenCount: 7, promptTokenCount: 3 },
          },
        ]),
      ),
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as unknown as GeminiClient,
    );

    const handler = createGenerateTextStreamHandler(
      deps as unknown as Parameters<typeof createGenerateTextStreamHandler>[0],
    );
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = {
      signal: new AbortController().signal,
      _meta: { progressToken: "token" },
      sendNotification,
    };

    const result = await handler(
      { prompt: "Say hello", conversationId: "conv-1" },
      extra,
    );

    expect(sendNotification).toHaveBeenCalled();
    expect(result).not.toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain("Hello world");
    expect(result.content[0]?.text).toContain("[usage]");
    expect(deps.conversationStore.get("conv-1")?.contents.length).toBe(2);
  });
});
