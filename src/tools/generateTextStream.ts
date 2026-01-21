import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
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

type ToolExtra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: ServerNotification) => Promise<void>;
};

async function sendProgress(
  extra: ToolExtra | undefined,
  progress: number,
  message?: string,
): Promise<void> {
  const progressToken = extra?._meta?.progressToken;
  if (!progressToken) return;
  await extra.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken,
      progress,
      ...(message ? { message } : {}),
    },
  });
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function registerGenerateTextStreamTool(
  server: McpServer,
  deps: Dependencies,
): void {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const maxInputChars = deps.config.limits.maxInputChars;
  const defaultMaxOutputTokens = deps.config.generation.maxOutputTokens;
  server.registerTool(
    "gemini_generate_text_stream",
    {
      title: "Gemini Generate Text (Streaming)",
      description: `Generate text with Gemini models and emit incremental progress notifications when requested by the client. Limits: maxTokens <= ${maxTokensLimit}, total input <= ${maxInputChars} chars.`,
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
        jsonMode: z
          .boolean()
          .optional()
          .describe("Request JSON output (sets response_mime_type)."),
        strictJson: z
          .boolean()
          .optional()
          .describe(
            "Validate that the model output is valid JSON (implies jsonMode).",
          ),
        jsonSchema: z
          .record(z.unknown())
          .optional()
          .describe(
            "Optional JSON Schema for structured output (implies jsonMode). Wrapper objects like { schema: {...} } are accepted.",
          ),
        grounding: z.boolean().optional(),
        includeGroundingMetadata: z.boolean().optional(),
        conversationId: z.string().optional(),
        safetySettings: z.array(safetySettingSchema).optional(),
      },
    },
    createGenerateTextStreamHandler(deps),
  );
}

export function createGenerateTextStreamHandler(
  deps: Dependencies,
  toolName = "gemini_generate_text_stream",
) {
  const toolDeps: ToolDependencies = deps;

  return async (
    {
      prompt,
      model,
      temperature,
      maxTokens,
      topK,
      topP,
      systemInstruction,
      jsonMode,
      strictJson,
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
      jsonMode?: boolean;
      strictJson?: boolean;
      jsonSchema?: Record<string, unknown>;
      grounding?: boolean;
      includeGroundingMetadata?: boolean;
      conversationId?: string;
      safetySettings?: Array<{ category: string; threshold: string }>;
    },
    extra: ToolExtra,
  ) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const wantsJson = Boolean(jsonMode || strictJson || jsonSchema);
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
          if (wantsJson)
            generationConfig.response_mime_type = "application/json";
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

          await sendProgress(extra, 0, "Starting streaming request…");

          let fullText = "";
          let lastChunk: unknown = undefined;
          let chunkIndex = 0;

          for await (const chunk of client.streamGenerateContent<unknown>(
            model ?? deps.config.model,
            requestBody,
            { signal: extra.signal },
          )) {
            lastChunk = chunk;
            chunkIndex += 1;
            const chunkText = extractText(chunk);
            if (!chunkText) continue;
            const delta = chunkText.startsWith(fullText)
              ? chunkText.slice(fullText.length)
              : chunkText;
            if (!delta) continue;
            fullText += delta;

            // Keep progress messages reasonably small for MCP clients.
            const msg = truncate(delta, 2000);
            await sendProgress(extra, fullText.length, msg);

            // Safety valve: avoid pathological infinite streams
            if (chunkIndex > 10_000) break;
          }

          const finishReason = extractFirstCandidateFinishReason(lastChunk);
          const blockReason = extractPromptBlockReason(lastChunk);
          const usage = extractUsage(lastChunk);
          const requestTokens = usage.totalTokens || estimatedInputTokens;

          await deps.dailyBudget.commit(
            toolName,
            requestTokens,
            undefined,
            reservation,
          );

          if (convoId) {
            deps.conversationStore.append(convoId, userMessage);
            if (fullText) {
              deps.conversationStore.append(convoId, {
                role: "model",
                parts: [{ text: fullText }],
              });
            }
          }

          const usageSummary = await deps.dailyBudget.getUsage();
          const usageFooter = formatUsageFooter(requestTokens, usageSummary);
          const warnings = takeAuthFallbackWarnings(client);
          const groundingMetadata = includeGroundingMetadata
            ? extractGroundingMetadata(lastChunk)
            : undefined;
          const groundingBlock = groundingMetadata
            ? textBlock(JSON.stringify({ groundingMetadata }, null, 2))
            : undefined;

          if (!fullText.trim()) {
            const diagnostics = [
              finishReason ? `finishReason=${finishReason}` : undefined,
              blockReason ? `blockReason=${blockReason}` : undefined,
            ]
              .filter(Boolean)
              .join(", ");
            const debug =
              deps.config.logging.debug && lastChunk
                ? `\n\nRaw response:\n${JSON.stringify(lastChunk, null, 2)}`
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

          if (wantsJson && strictJson) {
            const parsed = parseJsonFromText(fullText);
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
          }

          if (wantsJson) {
            return {
              content: [
                textBlock(fullText),
                ...(groundingBlock ? [groundingBlock] : []),
                textBlock(usageFooter),
                ...warnings,
              ],
            };
          }

          return {
            content: [
              textBlock(`${fullText}\n\n${usageFooter}`),
              ...(groundingBlock ? [groundingBlock] : []),
              ...warnings,
            ],
          };
        },
      );
    });
  };
}
