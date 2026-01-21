import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  listCuratedGeminiModels,
  type CuratedModel,
} from "../models/curatedModels.js";
import { redactString } from "../utils/redact.js";

type JsonValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

function normalizeModelName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("models/")
    ? trimmed.slice("models/".length)
    : trimmed;
}

function buildModelCapability(
  model: CuratedModel,
  config: BridgeConfig,
): JsonValue {
  const modalities = model.features.includes("vision")
    ? ["text", "image"]
    : ["text"];

  return {
    name: model.name,
    description: model.description,
    contextWindow: model.contextWindow ?? null,
    features: model.features,
    modalities,
    supports: {
      generateText: true,
      generateTextStream: true,
      generateJson: model.features.includes("json_mode"),
      analyzeImage: model.features.includes("vision"),
      embedText: true,
      countTokens: true,
      grounding: model.features.includes("grounding"),
      systemInstruction: model.features.includes("system_instructions"),
    },
    limits: {
      maxTokensPerRequest: config.limits.maxTokensPerRequest,
      maxInputChars: config.limits.maxInputChars,
    },
  };
}

function buildAllModelCapabilities(config: BridgeConfig): JsonValue {
  const curated = listCuratedGeminiModels("all");
  return {
    defaultModel: config.model,
    curatedModels: curated.map((model) => buildModelCapability(model, config)),
    notes: [
      "This is curated metadata (best-effort) intended for client auto-configuration.",
      "Use gemini_list_models for a live list from the Gemini API (and curated fallback).",
    ],
  };
}

function findCuratedModel(name: string): CuratedModel | undefined {
  const normalized = normalizeModelName(name);
  return listCuratedGeminiModels("all").find((m) => m.name === normalized);
}

function jsonResource(
  uri: string,
  build: () => JsonValue,
  logger: Logger,
): Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}> {
  try {
    const payload = build();
    return Promise.resolve({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to load model capabilities resource", {
      uri,
      error: redactString(message),
    });
    return Promise.resolve({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Resource unavailable" }, null, 2),
        },
      ],
    });
  }
}

export function registerModelCapabilitiesResources(
  server: McpServer,
  config: BridgeConfig,
  logger: Logger,
): void {
  server.registerResource(
    "gemini_model_capabilities",
    "gemini://model-capabilities",
    {
      title: "Gemini Model Capabilities",
      description:
        "Curated per-model capabilities (modalities, context window, supported params) for client auto-configuration.",
      mimeType: "application/json",
    },
    async () =>
      jsonResource(
        "gemini://model-capabilities",
        () => buildAllModelCapabilities(config),
        logger,
      ),
  );

  server.registerResource(
    "llm_model_capabilities",
    "llm://model-capabilities",
    {
      title: "LLM Model Capabilities (Gemini)",
      description:
        "Provider-agnostic alias for gemini://model-capabilities (Gemini MCP Bridge).",
      mimeType: "application/json",
    },
    async () =>
      jsonResource(
        "llm://model-capabilities",
        () => buildAllModelCapabilities(config),
        logger,
      ),
  );

  const template = new ResourceTemplate("gemini://model/{name}", {
    list: undefined,
    complete: {
      name: (value) => {
        const prefix = value.trim().toLowerCase();
        return listCuratedGeminiModels("all")
          .map((m) => m.name)
          .filter((name) => name.toLowerCase().startsWith(prefix))
          .slice(0, 50);
      },
    },
  });

  server.registerResource(
    "gemini_model_capability",
    template,
    {
      title: "Gemini Model Capability",
      description: "Curated capabilities for a single Gemini model.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const name = typeof variables.name === "string" ? variables.name : "";
      return jsonResource(
        `gemini://model/${encodeURIComponent(name)}`,
        () => {
          const model = findCuratedModel(name);
          if (!model) return { error: `Unknown model: ${name}` };
          return buildModelCapability(model, config);
        },
        logger,
      );
    },
  );
}
