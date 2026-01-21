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
  extractGroundingMetadata,
  extractUsage,
} from "../utils/geminiResponses.js";
import { parseJsonFromText } from "../utils/jsonParse.js";
import {
  type ToolDependencies,
  validateInputSize,
  validateMaxTokens,
  normalizeResponseJsonSchema,
  createGeminiClient,
  withToolErrorHandling,
  withBudgetReservation,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.record(jsonValueSchema),
    z.array(jsonValueSchema),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ]),
);

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

export function registerGenerateJsonTool(
  server: McpServer,
  deps: Dependencies,
): void {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const maxInputChars = deps.config.limits.maxInputChars;
  const defaultMaxOutputTokens = deps.config.generation.maxOutputTokens;
  server.registerTool(
    "gemini_generate_json",
    {
      title: "Gemini Generate JSON",
      description: `Generate structured JSON and return it as MCP structuredContent. Limits: maxTokens <= ${maxTokensLimit}, total input <= ${maxInputChars} chars.`,
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe(
            `User prompt. Total input (prompt + systemInstruction + conversation history) must be <= ${maxInputChars} characters.`,
          ),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z
          .number()
          .int()
          .positive()
          .max(maxTokensLimit)
          .optional()
          .describe(
            `Max output tokens (<= ${maxTokensLimit}). Defaults to ${defaultMaxOutputTokens} if omitted.`,
          ),
        topK: z.number().int().positive().optional(),
        topP: z.number().min(0).max(1).optional(),
        systemInstruction: z
          .string()
          .optional()
          .describe(
            `Optional system instruction (counts toward the ${maxInputChars} character total input limit).`,
          ),
        jsonSchema: z
          .record(z.unknown())
          .optional()
          .describe(
            "Optional JSON Schema for structured output. Wrapper objects like { schema: {...} } are accepted.",
          ),
        grounding: z.boolean().optional(),
        includeGroundingMetadata: z.boolean().optional(),
        conversationId: z.string().optional(),
        safetySettings: z.array(safetySettingSchema).optional(),
      },
      outputSchema: jsonValueSchema,
    },
    createGenerateJsonHandler(deps),
  );
}

export function createGenerateJsonHandler(
  deps: Dependencies,
  toolName = "gemini_generate_json",
) {
  const toolDeps: ToolDependencies = deps;

  return async ({
    prompt,
    model,
    temperature,
    maxTokens,
    topK,
    topP,
    systemInstruction,
    jsonSchema,
    grounding,
    includeGroundingMetadata,
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
    jsonSchema?: Record<string, unknown>;
    grounding?: boolean;
    includeGroundingMetadata?: boolean;
    conversationId?: string;
    safetySettings?: Array<{ category: string; threshold: string }>;
  }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
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
            response_mime_type: "application/json",
          };
          if (jsonSchema) {
            const normalizedSchema = normalizeResponseJsonSchema(jsonSchema);
            if (Object.keys(normalizedSchema).length > 0) {
              generationConfig.response_json_schema = normalizedSchema;
            }
          }

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
            toolName,
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
          const groundingMetadata = includeGroundingMetadata
            ? extractGroundingMetadata(response)
            : undefined;
          const groundingBlock = groundingMetadata
            ? textBlock(JSON.stringify({ groundingMetadata }, null, 2))
            : undefined;

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
                ...(groundingBlock ? [groundingBlock] : []),
                ...warnings,
              ],
            };
          }

          const parsed = parseJsonFromText(text);
          if (!parsed.ok) {
            return {
              isError: true,
              content: [
                textBlock(
                  `Model returned invalid JSON (${parsed.error}). Body starts with: ${JSON.stringify(parsed.snippet)}.\n\n${usageFooter}`,
                ),
                ...(groundingBlock ? [groundingBlock] : []),
                ...warnings,
              ],
            };
          }

          return {
            structuredContent: parsed.value,
            content: [
              textBlock(JSON.stringify(parsed.value, null, 2)),
              ...(groundingBlock ? [groundingBlock] : []),
              textBlock(usageFooter),
              ...warnings,
            ],
          };
        },
      );
    });
  };
}
