import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConversationStore } from "../services/conversationStore.js";
import { type ToolDependencies as BaseToolDependencies } from "../utils/toolHelpers.js";
import { registerGenerateTextTool } from "./generateText.js";
import { registerAnalyzeImageTool } from "./analyzeImage.js";
import { registerEmbedTextTool } from "./embedText.js";
import { registerCountTokensTool } from "./countTokens.js";
import { registerListModelsTool } from "./listModels.js";
import { registerGetHelpTool } from "./getHelp.js";

/**
 * Full tool dependencies including conversation store.
 * Extends the base ToolDependencies from toolHelpers.
 */
export type ToolDependencies = BaseToolDependencies & {
  conversationStore: ConversationStore;
};

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  registerGenerateTextTool(server, deps);
  registerAnalyzeImageTool(server, deps);
  registerEmbedTextTool(server, deps);
  registerCountTokensTool(server, deps);
  registerListModelsTool(server, deps);
  registerGetHelpTool(server);
}
