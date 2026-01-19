import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { Logger } from "../logger.js";
import { redactString } from "../utils/redact.js";

export function registerUsageResource(
  server: McpServer,
  budget: DailyTokenBudget,
  logger: Logger,
): void {
  server.registerResource(
    "usage_stats",
    "usage://stats",
    {
      title: "Usage Stats",
      description:
        "Token budget usage and per-tool stats (per-process; aggregated when shared limits are enabled).",
      mimeType: "application/json",
    },
    async () => {
      try {
        const usage = await budget.getUsage();
        return {
          contents: [
            {
              uri: "usage://stats",
              mimeType: "application/json",
              text: JSON.stringify(usage, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load usage stats", {
          error: redactString(message),
        });
        return {
          contents: [
            {
              uri: "usage://stats",
              mimeType: "application/json",
              text: JSON.stringify(
                { error: "Usage stats unavailable" },
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
