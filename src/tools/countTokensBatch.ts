import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import { isRecord } from "../utils/typeGuards.js";
import { formatToolError } from "../utils/toolErrors.js";
import {
  type ToolDependencies,
  validateInputSize,
  createGeminiClient,
  withToolErrorHandling,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const MAX_BATCH = 256;

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

type TokenCountItemResult =
  | {
      index: number;
      ok: true;
      totalTokens?: number;
      raw: unknown;
    }
  | { index: number; ok: false; error: string };

const countTokensBatchResultSchema = z.object({
  model: z.string(),
  results: z.array(
    z.union([
      z.object({
        index: z.number().int().nonnegative(),
        ok: z.literal(true),
        totalTokens: z.number().int().nonnegative().optional(),
        raw: z.unknown(),
      }),
      z.object({
        index: z.number().int().nonnegative(),
        ok: z.literal(false),
        error: z.string(),
      }),
    ]),
  ),
});

function extractTotalTokens(response: unknown): number | undefined {
  if (!isRecord(response)) return undefined;
  const totalTokens = response.totalTokens;
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
    return Math.max(0, Math.trunc(totalTokens));
  }
  const totalTokenCount = response.totalTokenCount;
  if (typeof totalTokenCount === "number" && Number.isFinite(totalTokenCount)) {
    return Math.max(0, Math.trunc(totalTokenCount));
  }
  return undefined;
}

export function registerCountTokensBatchTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_count_tokens_batch",
    {
      title: "Gemini Count Tokens (Batch)",
      description:
        "Count tokens for an array of inputs. Returns best-effort per-item results.",
      inputSchema: {
        texts: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
        model: z.string().optional(),
      },
      outputSchema: countTokensBatchResultSchema,
    },
    createCountTokensBatchHandler(deps),
  );
}

export function createCountTokensBatchHandler(
  deps: Dependencies,
  toolName = "gemini_count_tokens_batch",
) {
  const toolDeps: ToolDependencies = deps;

  return async ({ texts, model }: { texts: string[]; model?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      // Token counting doesn't spend tokens, but we still enforce daily budget limits.
      await deps.dailyBudget.checkOrThrow();

      const client = await createGeminiClient(toolDeps);
      const resolvedModel = model ?? deps.config.model;

      const results: TokenCountItemResult[] = [];

      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i] ?? "";
        const inputError = validateInputSize(
          text,
          deps.config.limits.maxInputChars,
        );
        if (inputError) {
          results.push({
            index: i,
            ok: false,
            error: inputError.content[0]?.text ?? "Invalid input.",
          });
          continue;
        }

        await deps.rateLimiter.checkOrThrow();
        try {
          const response = await client.countTokens<unknown>(resolvedModel, {
            contents: [{ role: "user", parts: [{ text }] }],
          });
          results.push({
            index: i,
            ok: true,
            ...(extractTotalTokens(response) !== undefined
              ? { totalTokens: extractTotalTokens(response) }
              : {}),
            raw: response,
          });
        } catch (error) {
          const info = formatToolError(error);
          results.push({ index: i, ok: false, error: info.message });
        }
      }

      await deps.dailyBudget.commit(toolName, 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      const warnings = takeAuthFallbackWarnings(client);

      const payload = { model: resolvedModel, results };
      return {
        structuredContent: payload,
        content: [
          textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`),
          ...warnings,
        ],
      };
    });
  };
}
