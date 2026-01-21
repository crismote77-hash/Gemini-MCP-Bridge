import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import { sortModelsNewToOld } from "../utils/modelSort.js";
import { isRecord } from "../utils/typeGuards.js";
import { redactString } from "../utils/redact.js";
import {
  listCuratedGeminiModels,
  type CuratedModelFilter,
} from "../models/curatedModels.js";
import {
  type ToolDependencies,
  createGeminiClient,
  checkLimits,
  withToolErrorHandling,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 200;

export function registerListModelsTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_list_models",
    {
      title: "Gemini List Models",
      description: "List Gemini models via the Gemini API.",
      inputSchema: {
        filter: z
          .enum(["all", "thinking", "vision", "grounding", "json_mode"])
          .optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
        pageToken: z.string().optional(),
      },
    },
    createListModelsHandler(deps),
  );
}

export function createListModelsHandler(deps: Dependencies) {
  return createListModelsHandlerForTool(deps, "gemini_list_models");
}

export function createListModelsHandlerForTool(
  deps: Dependencies,
  toolName: string,
) {
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
    return withToolErrorHandling(toolName, toolDeps, async () => {
      if (filter) {
        // Still check rate limits for curated queries to prevent abuse
        await deps.rateLimiter.checkOrThrow();
        const curated = sortModelsNewToOld(listCuratedGeminiModels(filter));
        await deps.dailyBudget.commit(toolName, 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        const payload = { source: "curated", filter, models: curated };
        return {
          content: [
            textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`),
          ],
        };
      }

      await checkLimits(toolDeps);
      try {
        const client = await createGeminiClient(toolDeps);
        const response = await client.listModels<unknown>({
          pageSize: limit ?? DEFAULT_LIMIT,
          pageToken,
        });
        const sortedResponse =
          isRecord(response) && Array.isArray(response.models)
            ? { ...response, models: sortModelsNewToOld(response.models) }
            : response;

        await deps.dailyBudget.commit(toolName, 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        const warnings = takeAuthFallbackWarnings(client);
        return {
          content: [
            textBlock(
              `${JSON.stringify(sortedResponse, null, 2)}\n\n${usageFooter}`,
            ),
            ...warnings,
          ],
        };
      } catch (error) {
        const curated = sortModelsNewToOld(listCuratedGeminiModels("all"));
        await deps.dailyBudget.commit(toolName, 0);
        const usage = await deps.dailyBudget.getUsage();
        const usageFooter = formatUsageFooter(0, usage);
        const message = redactString(
          error instanceof Error ? error.message : String(error),
        );
        const payload = {
          source: "curated",
          filter: "all",
          fallback: true,
          error: message,
          models: curated,
        };
        return {
          content: [
            textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`),
            textBlock(
              `Warning: Gemini API listModels failed (${message}). Returned curated metadata instead.`,
            ),
          ],
        };
      }
    });
  };
}
