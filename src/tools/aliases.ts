import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./index.js";
import { createGenerateTextHandler } from "./generateText.js";
import { createGenerateTextStreamHandler } from "./generateTextStream.js";
import { createGenerateJsonHandler } from "./generateJson.js";
import { createAnalyzeImageHandlerForTool } from "./analyzeImage.js";
import { createEmbedTextHandlerForTool } from "./embedText.js";
import { createEmbedTextBatchHandler } from "./embedTextBatch.js";
import { createCountTokensHandlerForTool } from "./countTokens.js";
import { createCountTokensBatchHandler } from "./countTokensBatch.js";
import { createListModelsHandlerForTool } from "./listModels.js";
import { createModerateTextHandler } from "./moderateText.js";
import {
  createConversationCreateHandler,
  createConversationExportHandler,
  createConversationListHandler,
  createConversationResetHandler,
} from "./conversationTools.js";

const safetySettingSchema = z.object({
  category: z.string(),
  threshold: z.string(),
});

export function registerAliasTools(server: McpServer, deps: ToolDependencies) {
  const maxTokensLimit = deps.config.limits.maxTokensPerRequest;
  const maxInputChars = deps.config.limits.maxInputChars;
  const defaultMaxOutputTokens = deps.config.generation.maxOutputTokens;
  const maxImageBytes = deps.config.images.maxBytes;
  server.registerTool(
    "llm_generate_text",
    {
      title: "LLM Generate Text (Gemini)",
      description: `Provider-agnostic alias for gemini_generate_text (implemented by Gemini MCP Bridge). Limits: maxTokens <= ${maxTokensLimit}, total input <= ${maxInputChars} chars.`,
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
    createGenerateTextHandler(deps, "llm_generate_text"),
  );

  server.registerTool(
    "llm_generate_text_stream",
    {
      title: "LLM Generate Text Stream (Gemini)",
      description: `Provider-agnostic alias for gemini_generate_text_stream (emits progress notifications when requested). Limits: maxTokens <= ${maxTokensLimit}, total input <= ${maxInputChars} chars.`,
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
    createGenerateTextStreamHandler(deps, "llm_generate_text_stream"),
  );

  server.registerTool(
    "llm_generate_json",
    {
      title: "LLM Generate JSON (Gemini)",
      description: `Provider-agnostic alias for gemini_generate_json (returns structuredContent). Limits: maxTokens <= ${maxTokensLimit}, total input <= ${maxInputChars} chars.`,
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
    },
    createGenerateJsonHandler(deps, "llm_generate_json"),
  );

  server.registerTool(
    "llm_analyze_image",
    {
      title: "LLM Analyze Image (Gemini)",
      description: `Provider-agnostic alias for gemini_analyze_image (implemented by Gemini MCP Bridge). Limits: maxTokens <= ${maxTokensLimit}, maxImageBytes <= ${maxImageBytes}.`,
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe(`User prompt (<= ${maxInputChars} characters).`),
        imageUrl: z.string().url().optional(),
        imageBase64: z.string().min(1).optional(),
        mimeType: z.string().optional(),
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
      },
    },
    createAnalyzeImageHandlerForTool(deps, "llm_analyze_image"),
  );

  server.registerTool(
    "llm_embed_text",
    {
      title: "LLM Embed Text (Gemini)",
      description:
        "Provider-agnostic alias for gemini_embed_text (implemented by Gemini MCP Bridge).",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
      },
    },
    createEmbedTextHandlerForTool(deps, "llm_embed_text"),
  );

  server.registerTool(
    "llm_embed_text_batch",
    {
      title: "LLM Embed Text Batch (Gemini)",
      description:
        "Provider-agnostic alias for gemini_embed_text_batch (best-effort per-item results).",
      inputSchema: {
        texts: z.array(z.string().min(1)).min(1),
        model: z.string().optional(),
      },
    },
    createEmbedTextBatchHandler(deps, "llm_embed_text_batch"),
  );

  server.registerTool(
    "llm_count_tokens",
    {
      title: "LLM Count Tokens (Gemini)",
      description:
        "Provider-agnostic alias for gemini_count_tokens (implemented by Gemini MCP Bridge).",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
      },
    },
    createCountTokensHandlerForTool(deps, "llm_count_tokens"),
  );

  server.registerTool(
    "llm_count_tokens_batch",
    {
      title: "LLM Count Tokens Batch (Gemini)",
      description:
        "Provider-agnostic alias for gemini_count_tokens_batch (best-effort per-item results).",
      inputSchema: {
        texts: z.array(z.string().min(1)).min(1),
        model: z.string().optional(),
      },
    },
    createCountTokensBatchHandler(deps, "llm_count_tokens_batch"),
  );

  server.registerTool(
    "llm_list_models",
    {
      title: "LLM List Models (Gemini)",
      description:
        "Provider-agnostic alias for gemini_list_models (implemented by Gemini MCP Bridge).",
      inputSchema: {
        filter: z
          .enum(["all", "thinking", "vision", "grounding", "json_mode"])
          .optional(),
        limit: z.number().int().positive().max(200).optional(),
        pageToken: z.string().optional(),
      },
    },
    createListModelsHandlerForTool(deps, "llm_list_models"),
  );

  server.registerTool(
    "llm_moderate_text",
    {
      title: "LLM Moderate Text (Gemini)",
      description:
        "Provider-agnostic alias for gemini_moderate_text (returns safety/block metadata).",
      inputSchema: {
        text: z.string().min(1),
        model: z.string().optional(),
        safetySettings: z.array(safetySettingSchema).optional(),
        includeRaw: z.boolean().optional(),
      },
    },
    createModerateTextHandler(deps, "llm_moderate_text"),
  );

  server.registerTool(
    "llm_conversation_create",
    {
      title: "LLM Conversation Create (Gemini)",
      description:
        "Provider-agnostic alias for gemini_conversation_create (in-memory per server session).",
      inputSchema: { conversationId: z.string().optional() },
    },
    createConversationCreateHandler(deps, "llm_conversation_create"),
  );

  server.registerTool(
    "llm_conversation_list",
    {
      title: "LLM Conversation List (Gemini)",
      description:
        "Provider-agnostic alias for gemini_conversation_list (in-memory per server session).",
      inputSchema: { limit: z.number().int().positive().max(200).optional() },
    },
    createConversationListHandler(deps, "llm_conversation_list"),
  );

  server.registerTool(
    "llm_conversation_export",
    {
      title: "LLM Conversation Export (Gemini)",
      description:
        "Provider-agnostic alias for gemini_conversation_export (in-memory per server session).",
      inputSchema: { conversationId: z.string().optional() },
    },
    createConversationExportHandler(deps, "llm_conversation_export"),
  );

  server.registerTool(
    "llm_conversation_reset",
    {
      title: "LLM Conversation Reset (Gemini)",
      description:
        "Provider-agnostic alias for gemini_conversation_reset (in-memory per server session).",
      inputSchema: { conversationId: z.string().optional() },
    },
    createConversationResetHandler(deps, "llm_conversation_reset"),
  );
}
