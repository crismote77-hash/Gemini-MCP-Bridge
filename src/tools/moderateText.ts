import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import {
  extractFirstCandidateFinishReason,
  extractFirstCandidateSafetyRatings,
  extractPromptBlockReason,
  extractPromptSafetyRatings,
  extractUsage,
} from "../utils/geminiResponses.js";
import {
  type ToolDependencies,
  validateInputSize,
  createGeminiClient,
  withToolErrorHandling,
  withBudgetReservation,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const safetySettingSchema = z.object({
  category: z.string(),
  threshold: z.string(),
});

const moderationResultSchema = z.object({
  model: z.string(),
  promptBlockReason: z.string().optional(),
  promptSafetyRatings: z.array(z.unknown()).optional(),
  candidateFinishReason: z.string().optional(),
  candidateSafetyRatings: z.array(z.unknown()).optional(),
  raw: z.unknown().optional(),
});

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export function registerModerateTextTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_moderate_text",
    {
      title: "Gemini Moderate Text",
      description:
        "Return Gemini safety/block metadata for a text input (best-effort).",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
        safetySettings: z.array(safetySettingSchema).optional(),
        includeRaw: z.boolean().optional(),
      },
      outputSchema: moderationResultSchema,
    },
    createModerateTextHandler(deps),
  );
}

export function createModerateTextHandler(
  deps: Dependencies,
  toolName = "gemini_moderate_text",
) {
  const toolDeps: ToolDependencies = deps;

  return async ({
    text,
    model,
    safetySettings,
    includeRaw,
  }: {
    text: string;
    model?: string;
    safetySettings?: Array<{ category: string; threshold: string }>;
    includeRaw?: boolean;
  }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const inputError = validateInputSize(
        text,
        deps.config.limits.maxInputChars,
      );
      if (inputError) return inputError;

      const client = await createGeminiClient(toolDeps);
      await deps.rateLimiter.checkOrThrow();

      const estimatedInputTokens = Math.ceil(text.length / 4);
      const reserveTokens = Math.max(0, estimatedInputTokens + 1);

      return withBudgetReservation(
        toolDeps,
        reserveTokens,
        async (reservation) => {
          const requestBody: Record<string, unknown> = {
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1,
            },
            ...(safetySettings ? { safetySettings } : {}),
          };

          const response = await client.generateContent<unknown>(
            model ?? deps.config.model,
            requestBody,
          );

          const promptBlockReason = extractPromptBlockReason(response);
          const promptSafetyRatings = extractPromptSafetyRatings(response);
          const candidateFinishReason =
            extractFirstCandidateFinishReason(response);
          const candidateSafetyRatings =
            extractFirstCandidateSafetyRatings(response);
          const usage = extractUsage(response);
          const requestTokens = usage.totalTokens || estimatedInputTokens;

          await deps.dailyBudget.commit(
            toolName,
            requestTokens,
            undefined,
            reservation,
          );

          const usageSummary = await deps.dailyBudget.getUsage();
          const usageFooter = formatUsageFooter(requestTokens, usageSummary);
          const warnings = takeAuthFallbackWarnings(client);

          const payload = {
            model: model ?? deps.config.model,
            ...(promptBlockReason ? { promptBlockReason } : {}),
            ...(promptSafetyRatings ? { promptSafetyRatings } : {}),
            ...(candidateFinishReason ? { candidateFinishReason } : {}),
            ...(candidateSafetyRatings ? { candidateSafetyRatings } : {}),
            ...(includeRaw ? { raw: response } : {}),
          };

          return {
            structuredContent: payload,
            content: [
              textBlock(
                `${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`,
              ),
              ...warnings,
            ],
          };
        },
      );
    });
  };
}
