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
import { parseJsonFromText } from "../utils/jsonParse.js";
import {
  type ToolDependencies,
  createGeminiClient,
  validateMaxTokens,
  withBudgetReservation,
  withToolErrorHandling,
  takeAuthFallbackWarnings,
} from "../utils/toolHelpers.js";
import type { RootsExtra } from "../utils/filesystemAccess.js";
import {
  applyUnifiedDiffToFilesystem,
  collectReadableTextFiles,
  parseUnifiedDiff,
  unifiedDiffSchema,
} from "../utils/filesystemAccess.js";

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

const fixResultSchema = z.object({
  summary: z.string().min(1),
  diff: unifiedDiffSchema,
  appliedFiles: z.array(z.string()).optional(),
});

export function registerCodeFixTool(
  server: McpServer,
  deps: Dependencies,
): void {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const fsMode = deps.config.filesystem.mode;
  const maxFiles = deps.config.filesystem.maxFiles;
  const maxFileBytes = deps.config.filesystem.maxFileBytes;
  const maxTotalBytes = deps.config.filesystem.maxTotalBytes;

  server.registerTool(
    "gemini_code_fix",
    {
      title: "Gemini Code Fix (Diff + Optional Auto-Apply)",
      description:
        "Generate a proposed fix as a unified diff by reading local files server-side (scoped by MCP roots when filesystem.mode=repo). By default returns a diff for approval; optional auto-apply requires filesystem.allowWrite=true.\n" +
        `Filesystem mode: ${fsMode}. Read limits: maxFiles=${maxFiles}, maxFileBytes=${maxFileBytes}, maxTotalBytes=${maxTotalBytes}. Output limit: maxTokens <= ${maxTokensLimit}.`,
      inputSchema: {
        request: z
          .string()
          .min(1)
          .describe(
            "What to change/fix. Example: 'Fix the failing tests and inconsistent error mapping.'",
          ),
        paths: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Files or directories to include (relative to the MCP root when mode=repo). Defaults to ['.'] (repo root).",
          ),
        apply: z
          .boolean()
          .optional()
          .describe(
            "If true, attempt to apply the generated diff locally (requires filesystem.allowWrite=true).",
          ),
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().max(maxTokensLimit).optional(),
      },
      outputSchema: fixResultSchema,
    },
    createCodeFixHandler(deps),
  );
}

export function createCodeFixHandler(
  deps: Dependencies,
  toolName = "gemini_code_fix",
) {
  const toolDeps: ToolDependencies = deps;

  return async (
    {
      request,
      paths,
      apply,
      model,
      temperature,
      maxTokens,
    }: {
      request: string;
      paths?: string[];
      apply?: boolean;
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

      const systemInstruction =
        "You are a senior software engineer making safe, minimal code fixes.\n" +
        "- Only modify existing files provided in the prompt.\n" +
        "- Do not add or delete files.\n" +
        "- Do not include secrets.\n" +
        "- Return a unified diff suitable for review/apply.\n";

      const prompt =
        `Fix request:\n${request}\n\n` +
        `Scope root: ${collected.root}\n` +
        `Files included: ${collected.files.length} (total bytes: ${collected.totalBytes}).\n` +
        (collected.skipped.length > 0
          ? `Files skipped: ${collected.skipped.length} (policy/size/binary). Do not ask for skipped content.\n`
          : "") +
        "\nRepository files:\n" +
        fileHeaders +
        "\n\nOutput format: JSON object with keys { summary: string, diff: string }. diff must be a unified diff.\n";

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
            response_mime_type: "application/json",
            response_json_schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "diff"],
              properties: {
                summary: { type: "string" },
                diff: { type: "string" },
              },
            },
          };

          const requestBody: Record<string, unknown> = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig,
            systemInstruction: { parts: [{ text: systemInstruction }] },
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

      const parsedJson = parseJsonFromText(text);
      if (!parsedJson.ok) {
        return {
          isError: true,
          content: [
            textBlock(
              `Model returned invalid JSON for diff output: ${parsedJson.error}`,
            ),
          ],
        };
      }

      const parsed = fixResultSchema.safeParse(parsedJson.value);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            textBlock(
              `Model returned JSON, but it did not match the expected schema: ${parsed.error.message}`,
            ),
          ],
        };
      }

      const { summary, diff } = parsed.data;

      // Basic validation: ensure the diff parses and only touches provided files.
      const diffFiles = parseUnifiedDiff(diff);
      const allowedPaths = new Set(collected.files.map((f) => f.relativePath));
      for (const file of diffFiles) {
        if (!file.newPath) continue;
        if (!allowedPaths.has(file.newPath)) {
          return {
            isError: true,
            content: [
              textBlock(
                `Generated diff references a file not in the provided set: ${file.newPath}`,
              ),
            ],
          };
        }
      }

      let appliedFiles: string[] | undefined;
      if (apply) {
        const applied = await applyUnifiedDiffToFilesystem(
          deps.config,
          extra,
          diff,
          deps.logger,
        );
        appliedFiles = applied.applied;
      }

      const usageSummary = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(
        response.requestTokens,
        usageSummary,
      );
      const warnings = takeAuthFallbackWarnings(client);

      const applyNote = apply
        ? `Applied changes to ${appliedFiles?.length ?? 0} file(s).`
        : "Diff generated for approval (not applied).";

      const contentBlocks = [
        textBlock(applyNote),
        textBlock(`Summary:\n${summary}`),
        textBlock(`Diff:\n\n\`\`\`diff\n${diff}\n\`\`\``),
        ...warnings,
        textBlock(usageFooter),
      ];

      return {
        content: contentBlocks,
        structuredContent: {
          summary,
          diff,
          ...(appliedFiles ? { appliedFiles } : {}),
        },
      };
    });
  };
}
