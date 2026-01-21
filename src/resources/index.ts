import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { ConversationStore } from "../services/conversationStore.js";
import { registerUsageResource } from "./usage.js";
import { registerConversationResource } from "./conversation.js";
import { registerDiscoveryResources } from "./discovery.js";
import { registerModelCapabilitiesResources } from "./modelCapabilities.js";

export function registerResources(
  server: McpServer,
  deps: {
    dailyBudget: DailyTokenBudget;
    conversationStore: ConversationStore;
    config: BridgeConfig;
    info: { name: string; version: string };
    logger: Logger;
  },
): void {
  registerUsageResource(server, deps.dailyBudget, deps.logger);
  registerConversationResource(server, deps.conversationStore, deps.logger);
  registerModelCapabilitiesResources(server, deps.config, deps.logger);
  registerDiscoveryResources(server, deps.config, deps.info, deps.logger);
}
