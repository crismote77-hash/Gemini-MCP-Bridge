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

function createImageSchema(config: BridgeConfig) {
  const maxTokensLimit = config.limits.maxTokensPerRequest;
  const maxInputChars = config.limits.maxInputChars;
  const defaultMaxOutputTokens = config.generation.maxOutputTokens;
  const maxImageBytes = config.images.maxBytes;

  return z.object({
    prompt: z
      .string()
      .min(1)
      .describe(`User prompt (<= ${maxInputChars} characters).`),
    imageUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Publicly accessible image URL (use only one of imageUrl/imageBase64).",
      ),
    imageBase64: z
      .string()
      .min(1)
      .optional()
      .describe(
        `Base64-encoded image bytes (max ${maxImageBytes} bytes; use only one of imageUrl/imageBase64).`,
      ),
    mimeType: z
      .string()
      .optional()
      .describe(
        "Image MIME type (required when using imageBase64; inferred when using imageUrl if available).",
      ),
    model: z.string().optional(),
    maxTokens: z
      .number()
      .int()
      .positive()
      .max(maxTokensLimit)
      .optional()
      .describe(
        `Max output tokens (<= ${maxTokensLimit}). Defaults to ${defaultMaxOutputTokens} if omitted.`,
      ),
  });
}

type ImageToolInput = z.infer<ReturnType<typeof createImageSchema>>;

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

async function loadImageFromUrl(
  url: string,
  maxBytes: number,
): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }
  const headerType = response.headers.get("content-type") ?? "";
  const contentType = headerType.split(";")[0]?.trim() ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds max size (${maxBytes} bytes)`);
  }
  return { data: buffer.toString("base64"), mimeType: contentType };
}

function validateMimeType(mimeType: string, allowed: string[]): void {
  if (!allowed.includes(mimeType)) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
}

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

function isValidBase64(str: string): boolean {
  if (str.length === 0) return false;
  if (str.length % 4 !== 0) return false;
  return BASE64_REGEX.test(str);
}

function decodeBase64Safely(base64: string): Buffer {
  if (!base64 || base64.trim().length === 0) {
    throw new Error("Image data is empty. Provide non-empty base64 data.");
  }

  const trimmed = base64.trim();
  if (!isValidBase64(trimmed)) {
    throw new Error(
      "Invalid base64 format. Ensure the imageBase64 value contains only valid base64 characters (A-Z, a-z, 0-9, +, /) with optional padding (=).",
    );
  }

  const buffer = Buffer.from(trimmed, "base64");
  if (buffer.length === 0) {
    throw new Error(
      "Image data decoded to empty buffer. Provide valid base64-encoded image data.",
    );
  }

  return buffer;
}

export function registerAnalyzeImageTool(
  server: McpServer,
  deps: Dependencies,
): void {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const maxImageBytes = deps.config.images.maxBytes;
  server.registerTool(
    "gemini_analyze_image",
    {
      title: "Gemini Analyze Image",
      description: `Analyze images with Gemini vision models. Limits: maxTokens <= ${maxTokensLimit}, maxImageBytes <= ${maxImageBytes}.`,
      inputSchema: createImageSchema(deps.config),
    },
    createAnalyzeImageHandler(deps),
  );
}

export function createAnalyzeImageHandler(deps: Dependencies) {
  return createAnalyzeImageHandlerForTool(deps, "gemini_analyze_image");
}

export function createAnalyzeImageHandlerForTool(
  deps: Dependencies,
  toolName: string,
) {
  const toolDeps: ToolDependencies = deps;

  return async (input: ImageToolInput) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const { prompt, imageUrl, imageBase64, mimeType, model, maxTokens } =
        input;
      if (!imageUrl && !imageBase64) {
        return {
          isError: true,
          content: [textBlock("Provide imageUrl or imageBase64.")],
        };
      }
      if (imageUrl && imageBase64) {
        return {
          isError: true,
          content: [textBlock("Provide only one of imageUrl or imageBase64.")],
        };
      }

      const outputLimit = maxTokens ?? deps.config.generation.maxOutputTokens;
      const tokenError = validateMaxTokens(
        outputLimit,
        deps.config.limits.maxTokensPerRequest,
      );
      if (tokenError) return tokenError;

      let data: string;
      let resolvedMime = mimeType ?? "";
      if (imageUrl) {
        const loaded = await loadImageFromUrl(
          imageUrl,
          deps.config.images.maxBytes,
        );
        data = loaded.data;
        resolvedMime = resolvedMime || loaded.mimeType;
      } else {
        const buffer = decodeBase64Safely(imageBase64 ?? "");
        if (buffer.length > deps.config.images.maxBytes) {
          return {
            isError: true,
            content: [
              textBlock(
                `Image exceeds max size (${deps.config.images.maxBytes} bytes).`,
              ),
            ],
          };
        }
        data = buffer.toString("base64");
      }

      if (!resolvedMime) {
        return {
          isError: true,
          content: [textBlock("Missing mimeType for image.")],
        };
      }
      validateMimeType(resolvedMime, deps.config.images.allowedMimeTypes);

      const combinedInput = prompt;
      const inputError = validateInputSize(
        combinedInput,
        deps.config.limits.maxInputChars,
      );
      if (inputError) return inputError;

      const client = await createGeminiClient(toolDeps);
      await deps.rateLimiter.checkOrThrow();

      // Estimate tokens: ~4 chars per token for text, ~750 base64 bytes per token for images
      // Images typically cost 258 tokens per 512x512 tile, but base64 size is a reasonable proxy
      const estimatedTextTokens = Math.ceil(combinedInput.length / 4);
      const estimatedImageTokens = Math.ceil(data.length / 750);
      const estimatedInputTokens = estimatedTextTokens + estimatedImageTokens;
      const reserveTokens = Math.max(0, outputLimit + estimatedInputTokens);

      return withBudgetReservation(
        toolDeps,
        reserveTokens,
        async (reservation) => {
          const requestBody = {
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: resolvedMime, data } },
                ],
              },
            ],
            generationConfig: {
              temperature: deps.config.generation.temperature,
              topK: deps.config.generation.topK,
              topP: deps.config.generation.topP,
              maxOutputTokens: outputLimit,
            },
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
          return {
            content: [textBlock(`${text}\n\n${usageFooter}`), ...warnings],
          };
        },
      );
    });
  };
}
