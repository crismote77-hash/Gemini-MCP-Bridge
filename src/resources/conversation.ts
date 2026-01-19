import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConversationStore } from "../services/conversationStore.js";
import type { Logger } from "../logger.js";
import { redactString } from "../utils/redact.js";

export function registerConversationResource(server: McpServer, store: ConversationStore, logger: Logger): void {
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
        logger.error("Failed to load conversation state", { error: redactString(message) });
        return {
          contents: [
            {
              uri: "conversation://current",
              mimeType: "application/json",
              text: JSON.stringify({ error: "Conversation data unavailable" }, null, 2),
            },
          ],
        };
      }
    },
  );
}
