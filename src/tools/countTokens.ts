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
  checkLimits,
  withToolErrorHandling,
} from "../utils/toolHelpers.js";

const DEFAULT_COUNT_MODEL = "gemini-2.5-flash";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export function registerCountTokensTool(server: McpServer, deps: Dependencies): void {
  server.registerTool(
    "gemini_count_tokens",
    {
      title: "Gemini Count Tokens",
      description: "Count tokens using Gemini API.",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
      },
    },
    createCountTokensHandler(deps),
  );
}

export function createCountTokensHandler(deps: Dependencies) {
  const toolDeps: ToolDependencies = deps;

  return async ({ text, model }: { text: string; model?: string }) => {
    return withToolErrorHandling("gemini_count_tokens", toolDeps, async () => {
      const inputError = validateInputSize(text, deps.config.limits.maxInputChars);
      if (inputError) return inputError;

      const client = await createGeminiClient(toolDeps);
      await checkLimits(toolDeps);

      const response = await client.countTokens<unknown>(model ?? DEFAULT_COUNT_MODEL, {
        contents: [{ role: "user", parts: [{ text }] }],
      });

      await deps.dailyBudget.commit("gemini_count_tokens", 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      return { content: [textBlock(`${JSON.stringify(response, null, 2)}\n\n${usageFooter}`)] };
    });
  };
}
