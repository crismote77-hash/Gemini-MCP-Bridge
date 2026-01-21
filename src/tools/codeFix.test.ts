import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { GeminiClient } from "../services/geminiClient.js";
import * as toolHelpers from "../utils/toolHelpers.js";
import type { RootsExtra } from "../utils/filesystemAccess.js";
import { createCodeFixHandler } from "./codeFix.js";

function createTempRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-mcp-bridge-"));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("gemini_code_fix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns structured diff JSON for approval (no auto-apply)", async () => {
    const repo = createTempRepo();
    try {
      const filePath = path.join(repo.dir, "a.ts");
      fs.writeFileSync(filePath, "old\n");

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
        filesystem: {
          mode: "repo",
          allowWrite: false,
          allowSystem: false,
          followSymlinks: true,
          maxFiles: 25,
          maxFileBytes: 200_000,
          maxTotalBytes: 2_000_000,
          allowedExtensions: [".ts"],
          denyPatterns: ["**/.git/**", "**/.env"],
        },
        logging: { debug: false },
      } as unknown as BridgeConfig;

      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const deps = {
        config,
        logger,
        rateLimiter: { checkOrThrow: vi.fn().mockResolvedValue(undefined) },
        dailyBudget: new DailyTokenBudget({ maxTokensPerDay: 1_000_000 }),
      };

      const diff = [
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n");

      const jsonText = JSON.stringify({ summary: "ok", diff });
      const client = {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: { parts: [{ text: jsonText }] },
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

      const extra = {
        requestId: "test",
        signal: new AbortController().signal,
        sendNotification: vi.fn(async () => undefined),
        sendRequest: vi.fn(async () => ({
          roots: [{ uri: pathToFileURL(repo.dir).toString() }],
        })),
      } as unknown as RootsExtra;

      const handler = createCodeFixHandler(deps as never);
      const result = await handler(
        { request: "Change old to new", paths: ["a.ts"] },
        extra,
      );

      expect((result as { isError?: boolean }).isError).toBeUndefined();
      expect(
        (result as unknown as { structuredContent: unknown }).structuredContent,
      ).toEqual({ summary: "ok", diff });
      expect(
        (result as { content: Array<{ text: string }> }).content
          .map((c) => c.text)
          .join("\n"),
      ).toContain("Diff generated for approval");
    } finally {
      repo.cleanup();
    }
  });
});
