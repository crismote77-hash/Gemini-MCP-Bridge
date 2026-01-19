import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { RateLimiter } from "./limits/rateLimiter.js";
import { DailyTokenBudget } from "./limits/dailyTokenBudget.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { ConversationStore } from "./services/conversationStore.js";
import { registerPrompts } from "./prompts/index.js";

export type SharedDependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export type ServerDependencies = SharedDependencies & {
  conversationStore: ConversationStore;
};

export function createMcpServer(
  deps: ServerDependencies,
  info: { name: string; version: string },
): McpServer {
  const server = new McpServer({ name: info.name, version: info.version });
  registerTools(server, deps);
  registerPrompts(server);
  registerResources(server, {
    dailyBudget: deps.dailyBudget,
    conversationStore: deps.conversationStore,
    config: deps.config,
    info,
    logger: deps.logger,
  });
  return server;
}
