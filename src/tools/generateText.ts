import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type {
  ConversationStore,
  ContentMessage,
} from "../services/conversationStore.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import {
  extractFirstCandidateFinishReason,
  extractPromptBlockReason,
  extractText,
  extractUsage,
} from "../utils/geminiResponses.js";
import {
  type ToolDependencies,
  validateInputSize,
  validateMaxTokens,
  createGeminiClient,
  withToolErrorHandling,
  withBudgetReservation,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const safetySettingSchema = z.object({
  category: z.string(),
  threshold: z.string(),
});

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
  conversationStore: ConversationStore;
};

function contentChars(contents: ContentMessage[]): number {
  return contents.reduce((sum, msg) => {
    const partChars = msg.parts.reduce(
      (acc, part) =>
        acc + (part.text?.length ?? 0) + (part.inlineData?.data?.length ?? 0),
      0,
    );
    return sum + partChars;
  }, 0);
}

export function registerGenerateTextTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_generate_text",
    {
      title: "Gemini Generate Text",
      description: "Generate text with Gemini models.",
      inputSchema: {
        prompt: z.string().min(1),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
        topK: z.number().int().positive().optional(),
        topP: z.number().min(0).max(1).optional(),
        systemInstruction: z.string().optional(),
        jsonMode: z.boolean().optional(),
        jsonSchema: z.record(z.unknown()).optional(),
        grounding: z.boolean().optional(),
        conversationId: z.string().optional(),
        safetySettings: z.array(safetySettingSchema).optional(),
      },
    },
    createGenerateTextHandler(deps),
  );
}

export function createGenerateTextHandler(deps: Dependencies) {
  const toolDeps: ToolDependencies = deps;

  return async ({
    prompt,
    model,
    temperature,
    maxTokens,
    topK,
    topP,
    systemInstruction,
    jsonMode,
    jsonSchema,
    grounding,
    conversationId,
    safetySettings,
  }: {
    prompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topK?: number;
    topP?: number;
    systemInstruction?: string;
    jsonMode?: boolean;
    jsonSchema?: Record<string, unknown>;
    grounding?: boolean;
    conversationId?: string;
    safetySettings?: Array<{ category: string; threshold: string }>;
  }) => {
    return withToolErrorHandling("gemini_generate_text", toolDeps, async () => {
      const outputLimit = maxTokens ?? deps.config.generation.maxOutputTokens;
      const tokenError = validateMaxTokens(
        outputLimit,
        deps.config.limits.maxTokensPerRequest,
      );
      if (tokenError) return tokenError;

      const convoId = conversationId?.trim();
      const previous = convoId
        ? deps.conversationStore.toRequestContents(convoId)
        : [];
      const conversationChars = contentChars(previous);
      const combinedInput = `${prompt}${systemInstruction ? `\n${systemInstruction}` : ""}`;
      const inputError = validateInputSize(
        combinedInput,
        deps.config.limits.maxInputChars,
        "total input",
        conversationChars,
      );
      if (inputError) return inputError;

      const client = await createGeminiClient(toolDeps);

      const userMessage: ContentMessage = {
        role: "user",
        parts: [{ text: prompt }],
      };
      const contents = [...previous, userMessage];

      await deps.rateLimiter.checkOrThrow();

      const estimatedInputTokens = Math.ceil(
        (combinedInput.length + conversationChars) / 4,
      );
      const reserveTokens = Math.max(0, outputLimit + estimatedInputTokens);

      return withBudgetReservation(
        toolDeps,
        reserveTokens,
        async (reservation) => {
          const generationConfig: Record<string, unknown> = {
            temperature: temperature ?? deps.config.generation.temperature,
            topK: topK ?? deps.config.generation.topK,
            topP: topP ?? deps.config.generation.topP,
            maxOutputTokens: outputLimit,
          };
          if (jsonMode)
            generationConfig.response_mime_type = "application/json";
          if (jsonSchema) generationConfig.response_json_schema = jsonSchema;

          const requestBody: Record<string, unknown> = {
            contents,
            generationConfig,
            ...(systemInstruction
              ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
              : {}),
            ...(safetySettings ? { safetySettings } : {}),
            ...(grounding ? { tools: [{ google_search: {} }] } : {}),
          };

          const response = await client.generateContent<unknown>(
            model ?? deps.config.model,
            requestBody,
          );
          const text = extractText(response);
          const finishReason = extractFirstCandidateFinishReason(response);
          const blockReason = extractPromptBlockReason(response);
          const usage = extractUsage(response);
          const requestTokens = usage.totalTokens || estimatedInputTokens;

          await deps.dailyBudget.commit(
            "gemini_generate_text",
            requestTokens,
            undefined,
            reservation,
          );

          if (convoId) {
            deps.conversationStore.append(convoId, userMessage);
            if (text) {
              deps.conversationStore.append(convoId, {
                role: "model",
                parts: [{ text }],
              });
            }
          }

          const usageSummary = await deps.dailyBudget.getUsage();
          const usageFooter = formatUsageFooter(requestTokens, usageSummary);
          const warnings = takeAuthFallbackWarnings(client);
          if (!text.trim()) {
            const diagnostics = [
              finishReason ? `finishReason=${finishReason}` : undefined,
              blockReason ? `blockReason=${blockReason}` : undefined,
            ]
              .filter(Boolean)
              .join(", ");
            const debug =
              deps.config.logging.debug && response
                ? `\n\nRaw response:\n${JSON.stringify(response, null, 2)}`
                : "";
            return {
              isError: true,
              content: [
                textBlock(
                  `No text returned by model.${diagnostics ? ` (${diagnostics})` : ""}${debug}\n\n${usageFooter}`,
                ),
                ...warnings,
              ],
            };
          }
          if (jsonMode) {
            return {
              content: [textBlock(text), textBlock(usageFooter), ...warnings],
            };
          }
          return {
            content: [textBlock(`${text}\n\n${usageFooter}`), ...warnings],
          };
        },
      );
    });
  };
}
