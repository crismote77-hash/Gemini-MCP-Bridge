import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { listCuratedGeminiModels } from "../models/curatedModels.js";
import { PROMPT_NAMES } from "../prompts/index.js";
import { redactString } from "../utils/redact.js";
import { HELP_EXAMPLES, HELP_PARAMETERS, HELP_USAGE } from "./helpContent.js";

type ServerInfo = { name: string; version: string };

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type ResourceSpec<T extends JsonValue | string> = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: "application/json" | "text/markdown";
  build: () => T;
};

const TOOL_NAMES = [
  "gemini_generate_text",
  "gemini_analyze_image",
  "gemini_embed_text",
  "gemini_count_tokens",
  "gemini_list_models",
  "gemini_get_help",
];

const RESOURCE_URIS = [
  "usage://stats",
  "conversation://current",
  "gemini://capabilities",
  "gemini://models",
  "gemini://help/usage",
  "gemini://help/parameters",
  "gemini://help/examples",
];

function registerJsonResource(server: McpServer, spec: ResourceSpec<JsonValue>, logger: Logger): void {
  server.registerResource(
    spec.name,
    spec.uri,
    {
      title: spec.title,
      description: spec.description,
      mimeType: spec.mimeType,
    },
    async () => {
      try {
        const payload = spec.build();
        return {
          contents: [
            {
              uri: spec.uri,
              mimeType: spec.mimeType,
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load discovery resource", { uri: spec.uri, error: redactString(message) });
        return {
          contents: [
            {
              uri: spec.uri,
              mimeType: spec.mimeType,
              text: JSON.stringify({ error: "Resource unavailable" }, null, 2),
            },
          ],
        };
      }
    },
  );
}

function registerTextResource(server: McpServer, spec: ResourceSpec<string>, logger: Logger): void {
  server.registerResource(
    spec.name,
    spec.uri,
    {
      title: spec.title,
      description: spec.description,
      mimeType: spec.mimeType,
    },
    async () => {
      try {
        const payload = spec.build();
        return {
          contents: [
            {
              uri: spec.uri,
              mimeType: spec.mimeType,
              text: payload,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load discovery resource", { uri: spec.uri, error: redactString(message) });
        return {
          contents: [
            {
              uri: spec.uri,
              mimeType: spec.mimeType,
              text: "# Resource unavailable\n\nThe resource could not be loaded.",
            },
          ],
        };
      }
    },
  );
}

function buildCapabilities(config: BridgeConfig, info: ServerInfo): JsonValue {
  return {
    name: info.name,
    version: info.version,
    transports: {
      stdio: true,
      http: true,
    },
    auth: {
      mode: config.auth.mode,
      oauthScopes: config.auth.oauthScopes,
      oauthTokenEnvVar: "GEMINI_MCP_OAUTH_TOKEN",
      googleApplicationCredentialsEnvVar: "GOOGLE_APPLICATION_CREDENTIALS",
      apiKeyEnvVar: config.auth.apiKeyEnvVar,
      apiKeyEnvVarAlt: config.auth.apiKeyEnvVarAlt,
      apiKeyFileEnvVar: config.auth.apiKeyFileEnvVar,
    },
    apiBaseUrl: config.apiBaseUrl,
    limits: {
      maxTokensPerRequest: config.limits.maxTokensPerRequest,
      maxInputChars: config.limits.maxInputChars,
      maxRequestsPerMinute: config.limits.maxRequestsPerMinute,
      maxTokensPerDay: config.limits.maxTokensPerDay,
      sharedLimitsEnabled: config.limits.shared.enabled,
    },
    defaults: {
      model: config.model,
      generation: config.generation,
    },
    tools: TOOL_NAMES,
    prompts: PROMPT_NAMES,
    resources: RESOURCE_URIS,
  };
}

function buildModels(config: BridgeConfig): JsonValue {
  return {
    defaultModel: config.model,
    generationDefaults: config.generation,
    curatedModels: listCuratedGeminiModels("all"),
    notes: [
      "Use gemini_list_models for a live list from the Gemini API.",
      "Use gemini_list_models with filter=all|thinking|vision|grounding|json_mode for curated metadata.",
      "When gemini_list_models is called without filter, it falls back to curated metadata if the API request fails.",
      "Model availability depends on your authentication and region.",
    ],
  };
}

export function registerDiscoveryResources(
  server: McpServer,
  config: BridgeConfig,
  info: ServerInfo,
  logger: Logger,
): void {
  registerJsonResource(server, {
    name: "gemini_capabilities",
    uri: "gemini://capabilities",
    title: "Gemini MCP Capabilities",
    description: "High-level server capabilities and defaults.",
    mimeType: "application/json",
    build: () => buildCapabilities(config, info),
  }, logger);

  registerJsonResource(server, {
    name: "gemini_models",
    uri: "gemini://models",
    title: "Gemini MCP Models",
    description: "Configured model defaults and generation settings.",
    mimeType: "application/json",
    build: () => buildModels(config),
  }, logger);

  registerTextResource(server, {
    name: "gemini_help_usage",
    uri: "gemini://help/usage",
    title: "Gemini MCP Help: Usage",
    description: "Quick-start usage guide for Gemini MCP Bridge.",
    mimeType: "text/markdown",
    build: () => HELP_USAGE,
  }, logger);

  registerTextResource(server, {
    name: "gemini_help_parameters",
    uri: "gemini://help/parameters",
    title: "Gemini MCP Help: Parameters",
    description: "Tool parameter reference.",
    mimeType: "text/markdown",
    build: () => HELP_PARAMETERS,
  }, logger);

  registerTextResource(server, {
    name: "gemini_help_examples",
    uri: "gemini://help/examples",
    title: "Gemini MCP Help: Examples",
    description: "Example prompts and resource reads.",
    mimeType: "text/markdown",
    build: () => HELP_EXAMPLES,
  }, logger);
}
