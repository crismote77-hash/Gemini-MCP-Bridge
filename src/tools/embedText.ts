import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import {
  type ToolDependencies,
  validateInputSize,
  createGeminiClient,
  withToolErrorHandling,
  withBudgetReservation,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const DEFAULT_EMBED_MODEL = "text-embedding-004";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export function registerEmbedTextTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_embed_text",
    {
      title: "Gemini Embed Text",
      description: "Generate text embeddings using Gemini embedding models.",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
      },
    },
    createEmbedTextHandler(deps),
  );
}

export function createEmbedTextHandler(deps: Dependencies) {
  return createEmbedTextHandlerForTool(deps, "gemini_embed_text");
}

export function createEmbedTextHandlerForTool(
  deps: Dependencies,
  toolName: string,
) {
  const toolDeps: ToolDependencies = deps;

  return async ({ text, model }: { text: string; model?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const inputError = validateInputSize(
        text,
        deps.config.limits.maxInputChars,
      );
      if (inputError) return inputError;

      const client = await createGeminiClient(toolDeps);
      await deps.rateLimiter.checkOrThrow();

      const estimatedTokens = Math.ceil(text.length / 4);

      return withBudgetReservation(
        toolDeps,
        estimatedTokens,
        async (reservation) => {
          const resolvedModel = model ?? DEFAULT_EMBED_MODEL;
          const response =
            client.backend === "vertex"
              ? await client.predict<unknown>(resolvedModel, {
                  instances: [{ content: text }],
                })
              : await client.embedContent<unknown>(resolvedModel, {
                  content: {
                    parts: [{ text }],
                  },
                });

          await deps.dailyBudget.commit(
            toolName,
            estimatedTokens,
            undefined,
            reservation,
          );

          const usage = await deps.dailyBudget.getUsage();
          const usageFooter = formatUsageFooter(estimatedTokens, usage);
          const warnings = takeAuthFallbackWarnings(client);
          return {
            content: [
              textBlock(
                `${JSON.stringify(response, null, 2)}\n\n${usageFooter}`,
              ),
              ...warnings,
            ],
          };
        },
      );
    });
  };
}
