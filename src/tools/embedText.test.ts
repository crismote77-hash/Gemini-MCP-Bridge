import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import { createEmbedTextHandler } from "./embedText.js";

describe("gemini_embed_text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeps(backend: "developer" | "vertex") {
    const config = {
      backend,
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

  it("uses embedContent on the Developer backend", async () => {
    const deps = createDeps("developer");
    const embedContent = vi.fn().mockResolvedValue({ ok: true });
    const predict = vi.fn().mockResolvedValue({ ok: true });
    const client = {
      backend: "developer",
      embedContent,
      predict,
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as any,
    );

    const handler = createEmbedTextHandler(deps as any);
    const result = await handler({ text: "Hello world" });

    expect(result).toHaveProperty("content");
    expect(embedContent).toHaveBeenCalledWith("text-embedding-004", {
      content: { parts: [{ text: "Hello world" }] },
    });
    expect(predict).not.toHaveBeenCalled();
  });

  it("uses predict on the Vertex backend", async () => {
    const deps = createDeps("vertex");
    const embedContent = vi.fn().mockResolvedValue({ ok: true });
    const predict = vi.fn().mockResolvedValue({ ok: true });
    const client = {
      backend: "vertex",
      embedContent,
      predict,
      takeNotices: () => [],
    };

    vi.spyOn(toolHelpers, "createGeminiClient").mockResolvedValue(
      client as any,
    );

    const handler = createEmbedTextHandler(deps as any);
    const result = await handler({ text: "Hello world" });

    expect(result).toHaveProperty("content");
    expect(predict).toHaveBeenCalledWith("text-embedding-004", {
      instances: [{ content: "Hello world" }],
    });
    expect(embedContent).not.toHaveBeenCalled();
  });
});
