import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HELP_EXAMPLES, HELP_PARAMETERS, HELP_USAGE } from "../resources/helpContent.js";
import { textBlock } from "../utils/textBlock.js";

type Topic = "overview" | "tools" | "models" | "parameters" | "examples" | "quick-start";

export function registerGetHelpTool(server: McpServer): void {
  server.registerTool(
    "gemini_get_help",
    {
      title: "Gemini Help",
      description: "Get help on using Gemini MCP Bridge.",
      inputSchema: {
        topic: z.enum(["overview", "tools", "models", "parameters", "examples", "quick-start"]).optional(),
      },
    },
    createGetHelpHandler(),
  );
}

export function createGetHelpHandler() {
  return async ({ topic }: { topic?: Topic }) => {
    switch (topic) {
      case "parameters":
        return { content: [textBlock(HELP_PARAMETERS)] };
      case "examples":
        return { content: [textBlock(HELP_EXAMPLES)] };
      case "tools":
        return {
          content: [
            textBlock(
              "Tools: gemini_generate_text, gemini_analyze_image, gemini_embed_text, gemini_count_tokens, gemini_list_models, gemini_get_help",
            ),
          ],
        };
      case "models":
        return {
          content: [
            textBlock(
              "gemini_list_models without filter tries the Gemini API listModels call and falls back to curated metadata on failure. gemini_list_models with filter (all|thinking|vision|grounding|json_mode) returns curated capability filtering.",
            ),
          ],
        };
      case "quick-start":
      case "overview":
      default:
        return { content: [textBlock(HELP_USAGE)] };
    }
  };
}
