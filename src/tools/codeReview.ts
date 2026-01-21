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
  createGeminiClient,
  validateMaxTokens,
  withBudgetReservation,
  withToolErrorHandling,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";
import type { RootsExtra } from "../utils/filesystemAccess.js";
import { collectReadableTextFiles } from "../utils/filesystemAccess.js";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export function registerCodeReviewTool(
  server: McpServer,
  deps: Dependencies,
): void {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const fsMode = deps.config.filesystem.mode;
  const maxFiles = deps.config.filesystem.maxFiles;
  const maxFileBytes = deps.config.filesystem.maxFileBytes;
  const maxTotalBytes = deps.config.filesystem.maxTotalBytes;

  server.registerTool(
    "gemini_code_review",
    {
      title: "Gemini Code Review (Filesystem + MCP Roots)",
      description:
        "Review local code using Gemini. The server reads files locally (scoped by MCP roots when filesystem.mode=repo) and returns only review results (not raw file contents).\n" +
        `Filesystem mode: ${fsMode}. Read limits: maxFiles=${maxFiles}, maxFileBytes=${maxFileBytes}, maxTotalBytes=${maxTotalBytes}. Output limit: maxTokens <= ${maxTokensLimit}.\n` +
        "To enable: set filesystem.mode=repo (recommended) or filesystem.mode=system (requires filesystem.allowSystem=true).",
      inputSchema: {
        request: z
          .string()
          .min(1)
          .describe(
            "What to review. Example: 'Review for security issues and inconsistent error handling; suggest improvements.'",
          ),
        paths: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Files or directories to include (relative to the MCP root when mode=repo). Defaults to ['.'] (repo root).",
          ),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().max(maxTokensLimit).optional(),
      },
    },
    createCodeReviewHandler(deps),
  );
}

export function createCodeReviewHandler(
  deps: Dependencies,
  toolName = "gemini_code_review",
) {
  const toolDeps: ToolDependencies = deps;

  return async (
    {
      request,
      paths,
      model,
      temperature,
      maxTokens,
    }: {
      request: string;
      paths?: string[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
    extra: RootsExtra,
  ) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const outputLimit = maxTokens ?? deps.config.generation.maxOutputTokens;
      const tokenError = validateMaxTokens(
        outputLimit,
        deps.config.limits.maxTokensPerRequest,
      );
      if (tokenError) return tokenError;

      const collected = await collectReadableTextFiles(
        deps.config,
        extra,
        paths ?? [],
      );
      if (collected.files.length === 0) {
        const skippedSummary =
          collected.skipped.length > 0
            ? `Skipped:\n- ${collected.skipped
                .slice(0, 10)
                .map((s) => `${s.path}: ${s.reason}`)
                .join("\n- ")}`
            : "No files were readable under the current policy.";
        return {
          isError: true,
          content: [textBlock(`No readable files found. ${skippedSummary}`)],
        };
      }

      const client = await createGeminiClient(toolDeps);
      await deps.rateLimiter.checkOrThrow();

      const fileHeaders = collected.files
        .map(
          (f) =>
            `\n\n=== FILE: ${f.relativePath} (${f.bytes} bytes) ===\n${f.text}`,
        )
        .join("");

      const instruction =
        "You are a senior software engineer. Perform a code review on the provided repository files.\n" +
        "- Do NOT repeat large chunks of source verbatim.\n" +
        "- Call out issues with file paths and (approximate) locations.\n" +
        "- Focus on correctness, security, maintainability, and consistency.\n" +
        "- Provide actionable recommendations and, where helpful, small snippets.\n";

      const prompt =
        `Review request:\n${request}\n\n` +
        `Scope root: ${collected.root}\n` +
        `Files included: ${collected.files.length} (total bytes: ${collected.totalBytes}).\n` +
        (collected.skipped.length > 0
          ? `Files skipped: ${collected.skipped.length} (policy/size/binary). Do not ask for skipped content.\n`
          : "") +
        "\nRepository files:\n" +
        fileHeaders;

      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const reserveTokens = Math.max(0, outputLimit + estimatedInputTokens);

      const response = await withBudgetReservation(
        toolDeps,
        reserveTokens,
        async (reservation) => {
          const generationConfig: Record<string, unknown> = {
            temperature: temperature ?? deps.config.generation.temperature,
            topK: deps.config.generation.topK,
            topP: deps.config.generation.topP,
            maxOutputTokens: outputLimit,
          };

          const requestBody: Record<string, unknown> = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig,
            systemInstruction: { parts: [{ text: instruction }] },
          };

          const resp = await client.generateContent<unknown>(
            model ?? deps.config.model,
            requestBody,
          );

          const usage = extractUsage(resp);
          const requestTokens = usage.totalTokens || estimatedInputTokens;
          await deps.dailyBudget.commit(
            toolName,
            requestTokens,
            undefined,
            reservation,
          );
          return { resp, requestTokens };
        },
      );

      const text = extractText(response.resp);
      const finishReason = extractFirstCandidateFinishReason(response.resp);
      const blockReason = extractPromptBlockReason(response.resp);

      if (!text.trim()) {
        return {
          isError: true,
          content: [
            textBlock(
              `No text returned by model (finishReason=${finishReason ?? "unknown"} blockReason=${blockReason ?? "none"}).`,
            ),
          ],
        };
      }

      const usageSummary = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(
        response.requestTokens,
        usageSummary,
      );
      const warnings = takeAuthFallbackWarnings(client);

      const header = textBlock(
        `Reviewed ${collected.files.length} file(s) (${collected.totalBytes} bytes). Skipped ${collected.skipped.length}.`,
      );
      const skippedBlock =
        collected.skipped.length > 0
          ? textBlock(
              `Skipped (first 20):\n- ${collected.skipped
                .slice(0, 20)
                .map((s) => `${s.path}: ${s.reason}`)
                .join("\n- ")}`,
            )
          : undefined;

      return {
        content: [
          header,
          ...(skippedBlock ? [skippedBlock] : []),
          ...warnings,
          textBlock(text),
          textBlock(usageFooter),
        ],
      };
    });
  };
}
