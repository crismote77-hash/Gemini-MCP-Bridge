import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { RateLimiter } from "../limits/rateLimiter.js";
import type { ConversationStore } from "../services/conversationStore.js";
import { textBlock } from "../utils/textBlock.js";
import { formatUsageFooter } from "../utils/usageFooter.js";
import {
  type ToolDependencies,
  withToolErrorHandling,
} from "../utils/toolHelpers.js";

const contentPartSchema = z.object({
  text: z.string().optional(),
  inlineData: z
    .object({
      mimeType: z.string(),
      data: z.string(),
    })
    .optional(),
});

const contentMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  parts: z.array(contentPartSchema),
});

const conversationStateSchema = z.object({
  id: z.string(),
  contents: z.array(contentMessageSchema),
  updatedAt: z.string(),
});

const conversationSummarySchema = z.object({
  id: z.string(),
  updatedAt: z.string(),
  turns: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
});

type Dependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
  conversationStore: ConversationStore;
};

export function registerConversationTools(
  server: McpServer,
  deps: Dependencies,
): void {
  server.registerTool(
    "gemini_conversation_create",
    {
      title: "Conversation Create",
      description: "Create (or focus) a conversation thread by id.",
      inputSchema: {
        conversationId: z.string().optional(),
      },
      outputSchema: conversationStateSchema,
    },
    createConversationCreateHandler(deps),
  );

  server.registerTool(
    "gemini_conversation_list",
    {
      title: "Conversation List",
      description: "List known conversation threads in this server session.",
      inputSchema: {
        limit: z.number().int().positive().max(200).optional(),
      },
      outputSchema: z.object({
        conversations: z.array(conversationSummarySchema),
      }),
    },
    createConversationListHandler(deps),
  );

  server.registerTool(
    "gemini_conversation_export",
    {
      title: "Conversation Export",
      description: "Export a conversation thread by id (defaults to current).",
      inputSchema: {
        conversationId: z.string().optional(),
      },
      outputSchema: conversationStateSchema,
    },
    createConversationExportHandler(deps),
  );

  server.registerTool(
    "gemini_conversation_reset",
    {
      title: "Conversation Reset",
      description: "Delete a conversation thread by id (defaults to current).",
      inputSchema: {
        conversationId: z.string().optional(),
      },
      outputSchema: z.object({
        ok: z.boolean(),
        conversationId: z.string(),
      }),
    },
    createConversationResetHandler(deps),
  );
}

export function createConversationCreateHandler(
  deps: Dependencies,
  toolName = "gemini_conversation_create",
) {
  const toolDeps: ToolDependencies = deps;
  return async ({ conversationId }: { conversationId?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const state = deps.conversationStore.create(conversationId);
      await deps.dailyBudget.commit(toolName, 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      return {
        structuredContent: state,
        content: [
          textBlock(`${JSON.stringify(state, null, 2)}\n\n${usageFooter}`),
        ],
      };
    });
  };
}

export function createConversationListHandler(
  deps: Dependencies,
  toolName = "gemini_conversation_list",
) {
  const toolDeps: ToolDependencies = deps;
  return async ({ limit }: { limit?: number }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const conversations = deps.conversationStore.listSummaries(limit ?? 50);
      const payload = { conversations };
      await deps.dailyBudget.commit(toolName, 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      return {
        structuredContent: payload,
        content: [
          textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`),
        ],
      };
    });
  };
}

export function createConversationExportHandler(
  deps: Dependencies,
  toolName = "gemini_conversation_export",
) {
  const toolDeps: ToolDependencies = deps;
  return async ({ conversationId }: { conversationId?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const id =
        conversationId?.trim() || deps.conversationStore.getCurrentId();
      if (!id) {
        return {
          isError: true,
          content: [
            textBlock("No current conversation. Provide conversationId."),
          ],
        };
      }
      const state = deps.conversationStore.get(id);
      if (!state) {
        return {
          isError: true,
          content: [textBlock(`Conversation not found: ${id}`)],
        };
      }

      await deps.dailyBudget.commit(toolName, 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      return {
        structuredContent: state,
        content: [
          textBlock(`${JSON.stringify(state, null, 2)}\n\n${usageFooter}`),
        ],
      };
    });
  };
}

export function createConversationResetHandler(
  deps: Dependencies,
  toolName = "gemini_conversation_reset",
) {
  const toolDeps: ToolDependencies = deps;
  return async ({ conversationId }: { conversationId?: string }) => {
    return withToolErrorHandling(toolName, toolDeps, async () => {
      const id =
        conversationId?.trim() || deps.conversationStore.getCurrentId();
      if (!id) {
        return {
          isError: true,
          content: [
            textBlock("No current conversation. Provide conversationId."),
          ],
        };
      }
      deps.conversationStore.reset(id);
      const payload = { ok: true, conversationId: id };
      await deps.dailyBudget.commit(toolName, 0);
      const usage = await deps.dailyBudget.getUsage();
      const usageFooter = formatUsageFooter(0, usage);
      return {
        structuredContent: payload,
        content: [
          textBlock(`${JSON.stringify(payload, null, 2)}\n\n${usageFooter}`),
        ],
      };
    });
  };
}
