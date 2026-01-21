import { describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { ConversationStore } from "../services/conversationStore.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  createConversationCreateHandler,
  createConversationExportHandler,
  createConversationListHandler,
  createConversationResetHandler,
} from "./conversationTools.js";

describe("gemini_conversation_*", () => {
  function createDeps() {
    const config = {} as BridgeConfig;
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

  it("creates and lists conversations", async () => {
    const deps = createDeps();
    const createHandler = createConversationCreateHandler(
      deps as unknown as Parameters<typeof createConversationCreateHandler>[0],
    );
    const listHandler = createConversationListHandler(
      deps as unknown as Parameters<typeof createConversationListHandler>[0],
    );

    const created = await createHandler({ conversationId: "conv-1" });
    expect(
      (created as unknown as { structuredContent: { id: string } })
        .structuredContent.id,
    ).toBe("conv-1");

    const listed = await listHandler({ limit: 10 });
    const payload = listed as unknown as {
      structuredContent: { conversations: Array<{ id: string }> };
    };
    expect(payload.structuredContent.conversations.length).toBe(1);
    expect(payload.structuredContent.conversations[0]?.id).toBe("conv-1");
  });

  it("exports and resets conversations", async () => {
    const deps = createDeps();
    deps.conversationStore.create("conv-2");

    const exportHandler = createConversationExportHandler(
      deps as unknown as Parameters<typeof createConversationExportHandler>[0],
    );
    const resetHandler = createConversationResetHandler(
      deps as unknown as Parameters<typeof createConversationResetHandler>[0],
    );

    const exported = await exportHandler({ conversationId: "conv-2" });
    expect(
      (exported as unknown as { structuredContent: { id: string } })
        .structuredContent.id,
    ).toBe("conv-2");

    const reset = await resetHandler({ conversationId: "conv-2" });
    expect(
      (reset as unknown as { structuredContent: { ok: boolean } })
        .structuredContent.ok,
    ).toBe(true);
    expect(deps.conversationStore.get("conv-2")).toBeUndefined();
  });

  it("errors when exporting without a current conversation", async () => {
    const deps = createDeps();
    const exportHandler = createConversationExportHandler(
      deps as unknown as Parameters<typeof createConversationExportHandler>[0],
    );
    const result = await exportHandler({});

    expect(result).toHaveProperty("isError", true);
    expect(result.content[0]?.text).toContain("No current conversation");
  });
});
