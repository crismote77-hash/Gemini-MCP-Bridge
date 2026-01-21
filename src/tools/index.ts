import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConversationStore } from "../services/conversationStore.js";
import { type ToolDependencies as BaseToolDependencies } from "../utils/toolHelpers.js";
import { registerGenerateTextTool } from "./generateText.js";
import { registerGenerateTextStreamTool } from "./generateTextStream.js";
import { registerGenerateJsonTool } from "./generateJson.js";
import { registerAnalyzeImageTool } from "./analyzeImage.js";
import { registerEmbedTextTool } from "./embedText.js";
import { registerEmbedTextBatchTool } from "./embedTextBatch.js";
import { registerCountTokensTool } from "./countTokens.js";
import { registerCountTokensBatchTool } from "./countTokensBatch.js";
import { registerListModelsTool } from "./listModels.js";
import { registerGetHelpTool } from "./getHelp.js";
import { registerModerateTextTool } from "./moderateText.js";
import { registerConversationTools } from "./conversationTools.js";
import { registerAliasTools } from "./aliases.js";
import { registerCodeReviewTool } from "./codeReview.js";
import { registerCodeFixTool } from "./codeFix.js";

/**
 * Full tool dependencies including conversation store.
 * Extends the base ToolDependencies from toolHelpers.
 */
export type ToolDependencies = BaseToolDependencies & {
  conversationStore: ConversationStore;
};

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  registerGenerateTextTool(server, deps);
  registerGenerateTextStreamTool(server, deps);
  registerGenerateJsonTool(server, deps);
  registerAnalyzeImageTool(server, deps);
  registerEmbedTextTool(server, deps);
  registerEmbedTextBatchTool(server, deps);
  registerCountTokensTool(server, deps);
  registerCountTokensBatchTool(server, deps);
  registerListModelsTool(server, deps);
  registerModerateTextTool(server, deps);
  registerCodeReviewTool(server, deps);
  registerCodeFixTool(server, deps);
  registerConversationTools(server, deps);
  registerGetHelpTool(server);
  registerAliasTools(server, deps);
}
