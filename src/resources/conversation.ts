import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConversationStore } from "../services/conversationStore.js";
import type { Logger } from "../logger.js";
import { redactString } from "../utils/redact.js";

export function registerConversationResource(
  server: McpServer,
  store: ConversationStore,
  logger: Logger,
): void {
  server.registerResource(
    "conversation_list",
    "conversation://list",
    {
      title: "Conversation List",
      description: "List known conversation threads in this server session.",
      mimeType: "application/json",
    },
    async () => {
      try {
        const currentId = store.getCurrentId();
        const conversations = store.listSummaries(200);
        const payload = { currentId, conversations };
        return {
          contents: [
            {
              uri: "conversation://list",
              mimeType: "application/json",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load conversation list", {
          error: redactString(message),
        });
        return {
          contents: [
            {
              uri: "conversation://list",
              mimeType: "application/json",
              text: JSON.stringify(
                { error: "Conversation data unavailable" },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    "conversation_current",
    "conversation://current",
    {
      title: "Current Conversation",
      description: "Latest conversation state (if any).",
      mimeType: "application/json",
    },
    async () => {
      try {
        const session = store.getCurrent();
        const payload =
          session ??
          ({
            id: null,
            contents: [],
            updatedAt: null,
          } as const);
        return {
          contents: [
            {
              uri: "conversation://current",
              mimeType: "application/json",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load conversation state", {
          error: redactString(message),
        });
        return {
          contents: [
            {
              uri: "conversation://current",
              mimeType: "application/json",
              text: JSON.stringify(
                { error: "Conversation data unavailable" },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  const historyTemplate = new ResourceTemplate("conversation://history/{id}", {
    list: () => {
      const conversations = store.listSummaries(200);
      return {
        resources: conversations.map((c) => ({
          name: `conversation_${c.id}`,
          uri: `conversation://history/${encodeURIComponent(c.id)}`,
          title: `Conversation ${c.id}`,
          description: `Conversation history for ${c.id}`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      id: (value) => {
        const prefix = value.trim().toLowerCase();
        return store
          .listSummaries(200)
          .map((c) => c.id)
          .filter((id) => id.toLowerCase().startsWith(prefix))
          .slice(0, 50);
      },
    },
  });

  server.registerResource(
    "conversation_history",
    historyTemplate,
    {
      title: "Conversation History",
      description: "Conversation history by id.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      try {
        const id = typeof variables.id === "string" ? variables.id : "";
        const state = store.get(id);
        const payload =
          state ??
          ({
            id,
            contents: [],
            updatedAt: null,
            error: "Conversation not found",
          } as const);
        return {
          contents: [
            {
              uri: `conversation://history/${encodeURIComponent(id)}`,
              mimeType: "application/json",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load conversation history", {
          error: redactString(message),
        });
        return {
          contents: [
            {
              uri: "conversation://history/{id}",
              mimeType: "application/json",
              text: JSON.stringify(
                { error: "Conversation data unavailable" },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}
