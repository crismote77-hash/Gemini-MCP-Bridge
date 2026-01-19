import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { ConversationStore } from "../services/conversationStore.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import { registerGenerateTextTool } from "./generateText.js";
import { registerAnalyzeImageTool } from "./analyzeImage.js";
import { registerEmbedTextTool } from "./embedText.js";
import { registerCountTokensTool } from "./countTokens.js";
import { registerListModelsTool } from "./listModels.js";
import { registerGetHelpTool } from "./getHelp.js";

export type ToolDependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
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
