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
  withBudgetReservation,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";

const DEFAULT_EMBED_MODEL = "text-embedding-004";
const MAX_BATCH = 128;

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

type EmbedBatchItemResult =
  | {
      index: number;
      ok: true;
      vector?: number[];
      raw: unknown;
    }
  | { index: number; ok: false; error: string };

const embedBatchResultSchema = z.object({
  model: z.string(),
  backend: z.enum(["developer", "vertex"]),
  results: z.array(
    z.union([
      z.object({
        index: z.number().int().nonnegative(),
        ok: z.literal(true),
        vector: z.array(z.number()).optional(),
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

function extractEmbeddingVector(response: unknown): number[] | undefined {
  if (!isRecord(response)) return undefined;

  const direct = response.embedding;
  if (isRecord(direct) && Array.isArray(direct.values)) {
    const values = direct.values.filter((v) => typeof v === "number");
    if (values.length > 0) return values;
  }

  const predictions = response.predictions;
  if (Array.isArray(predictions) && predictions.length > 0) {
    const first = predictions[0];
    if (isRecord(first)) {
      const embeddings = first.embeddings;
      if (isRecord(embeddings) && Array.isArray(embeddings.values)) {
        const values = embeddings.values.filter((v) => typeof v === "number");
        if (values.length > 0) return values;
      }
      if (Array.isArray(first.values)) {
        const values = first.values.filter((v) => typeof v === "number");
        if (values.length > 0) return values;
      }
    }
  }

  return undefined;
}

export function registerEmbedTextBatchTool(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_embed_text_batch",
    {
      title: "Gemini Embed Text (Batch)",
      description:
        "Generate text embeddings for an array of inputs. Returns best-effort per-item results.",
      inputSchema: {
        texts: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
        model: z.string().optional(),
      },
      outputSchema: embedBatchResultSchema,
    },
    createEmbedTextBatchHandler(deps),
  );
}

export function createEmbedTextBatchHandler(
  deps: Dependencies,
  toolName = "gemini_embed_text_batch",
) {
  const toolDeps: ToolDependencies = deps;

  return async ({ texts, model }: { texts: string[]; model?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const client = await createGeminiClient(toolDeps);
      const resolvedModel = model ?? DEFAULT_EMBED_MODEL;

      const results: EmbedBatchItemResult[] = [];
      const planned: Array<{ index: number; text: string; tokens: number }> =
        [];
      let reserveTokens = 0;

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
        const estimatedTokens = Math.ceil(text.length / 4);
        reserveTokens += estimatedTokens;
        planned.push({ index: i, text, tokens: estimatedTokens });
        results.push({ index: i, ok: true, raw: null });
      }

      return withBudgetReservation(
        toolDeps,
        reserveTokens,
        async (reservation) => {
          for (const item of planned) {
            await deps.rateLimiter.checkOrThrow();
            try {
              const response =
                client.backend === "vertex"
                  ? await client.predict<unknown>(resolvedModel, {
                      instances: [{ content: item.text }],
                    })
                  : await client.embedContent<unknown>(resolvedModel, {
                      content: { parts: [{ text: item.text }] },
                    });
              const vector = extractEmbeddingVector(response);
              results[item.index] = {
                index: item.index,
                ok: true,
                ...(vector ? { vector } : {}),
                raw: response,
              };
            } catch (error) {
              const info = formatToolError(error);
              results[item.index] = {
                index: item.index,
                ok: false,
                error: info.message,
              };
            }
          }

          await deps.dailyBudget.commit(
            toolName,
            reserveTokens,
            undefined,
            reservation,
          );

          const usage = await deps.dailyBudget.getUsage();
          const usageFooter = formatUsageFooter(reserveTokens, usage);
          const warnings = takeAuthFallbackWarnings(client);

          const payload = {
            model: resolvedModel,
            backend: client.backend,
            results,
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
