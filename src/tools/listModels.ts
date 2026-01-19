import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import { listCuratedGeminiModels, type CuratedModelFilter } from "../models/curatedModels.js";
import {
  type ToolDependencies,
  createGeminiClient,
  checkLimits,
  withToolErrorHandling,
} from "../utils/toolHelpers.js";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

const MAX_LIMIT = 200;

export function registerListModelsTool(server: McpServer, deps: Dependencies): void {
  server.registerTool(
    "gemini_list_models",
    {
      title: "Gemini List Models",
      description: "List Gemini models via the Gemini API.",
      inputSchema: {
        filter: z.enum(["all", "thinking", "vision", "grounding", "json_mode"]).optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
        pageToken: z.string().optional(),
      },
    },
    createListModelsHandler(deps),
  );
}

export function createListModelsHandler(deps: Dependencies) {
  const toolDeps: ToolDependencies = deps;

  return async ({
    limit,
    pageToken,
    filter,
  }: {
    limit?: number;
    pageToken?: string;
    filter?: CuratedModelFilter;
  }) => {
    return withToolErrorHandling("gemini_list_models", toolDeps, async () => {
      if (filter) {
        const curated = listCuratedGeminiModels(filter);
        await deps.dailyBudget.commit("gemini_list_models", 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        const payload = { source: "curated", filter, models: curated };
        return { content: [textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`)] };
      }

      await checkLimits(toolDeps);
      try {
        const client = await createGeminiClient(toolDeps);
        const response = await client.listModels<unknown>({
          pageSize: limit ?? 20,
          pageToken,
        });

        await deps.dailyBudget.commit("gemini_list_models", 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        return { content: [textBlock(`${JSON.stringify(response, null, 2)}\n\n${usageFooter}`)] };
      } catch (error) {
        const curated = listCuratedGeminiModels("all");
        await deps.dailyBudget.commit("gemini_list_models", 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        const message = error instanceof Error ? error.message : String(error);
        const payload = {
          source: "curated",
          filter: "all",
          fallback: true,
          error: message,
          models: curated,
        };
        return {
          isError: true,
          content: [textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`)],
        };
      }
    });
  };
}
