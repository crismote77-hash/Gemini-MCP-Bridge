import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { textBlock } from "../utils/textBlock.js";

export const PROMPT_NAMES = [
  "code_review",
  "explain_with_thinking",
  "creative_writing",
] as const;

function singleMessagePrompt(text: string): GetPromptResult {
  return {
    messages: [
      {
        role: "user",
        content: textBlock(text),
      },
    ],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "code_review",
    {
      title: "Code Review",
      description:
        "Review code for correctness, security, and maintainability.",
      argsSchema: {
        code: z.string().min(1),
        language: z.string().optional(),
      },
    },
    ({ code, language }) => {
      const lang = language?.trim();
      const header = lang
        ? `Review the following ${lang} code for correctness, security, and maintainability:`
        : "Review the following code for correctness, security, and maintainability:";
      return singleMessagePrompt(`${header}\n\n${code}`);
    },
  );

  server.registerPrompt(
    "explain_with_thinking",
    {
      title: "Explain With Thinking",
      description: "Explain a topic with step-by-step reasoning.",
      argsSchema: {
        topic: z.string().min(1),
        level: z.enum(["beginner", "intermediate", "expert"]).optional(),
      },
    },
    ({ topic, level }) => {
      const levelText = level ?? "intermediate";
      return singleMessagePrompt(
        `Explain ${topic} at a ${levelText} level. Think step-by-step and provide a clear explanation.`,
      );
    },
  );

  server.registerPrompt(
    "creative_writing",
    {
      title: "Creative Writing",
      description: "Generate creative writing based on a prompt.",
      argsSchema: {
        prompt: z.string().min(1),
        style: z.string().optional(),
        length: z.string().optional(),
      },
    },
    ({ prompt, style, length }) => {
      const lengthText = length ? `${length} ` : "short ";
      const styleText = style ? `${style} ` : "";
      return singleMessagePrompt(
        `Write a ${lengthText}${styleText}piece based on: ${prompt}`,
      );
    },
  );
}
