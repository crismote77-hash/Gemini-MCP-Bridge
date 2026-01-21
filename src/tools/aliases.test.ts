import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { ConversationStore } from "../services/conversationStore.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { registerAliasTools } from "./aliases.js";

describe("llm_* aliases", () => {
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
        allowedMimeTypes: ["image/png"],
      },
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

  it("registers all alias tools", () => {
    const deps = createDeps();
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;

    registerAliasTools(
      server,
      deps as unknown as Parameters<typeof registerAliasTools>[1],
    );

    const names = registerTool.mock.calls.map((call) => call[0]);
    const expected = [
      "llm_generate_text",
      "llm_generate_text_stream",
      "llm_generate_json",
      "llm_analyze_image",
      "llm_embed_text",
      "llm_embed_text_batch",
      "llm_count_tokens",
      "llm_count_tokens_batch",
      "llm_list_models",
      "llm_moderate_text",
      "llm_conversation_create",
      "llm_conversation_list",
      "llm_conversation_export",
      "llm_conversation_reset",
    ];

    expect(new Set(names)).toEqual(new Set(expected));
    expect(registerTool).toHaveBeenCalledTimes(expected.length);
    for (const call of registerTool.mock.calls) {
      expect(typeof call[2]).toBe("function");
    }
  });
});
