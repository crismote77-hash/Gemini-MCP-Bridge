import type { BridgeConfig } from "../config.js";
import { ConfigError } from "../errors.js";

export function resolveVertexApiBaseUrl(config: BridgeConfig): string {
  const explicit = (config.vertex.apiBaseUrl ?? "").trim();
  if (explicit) return explicit;

  const project = (config.vertex.project ?? "").trim();
  const location = (config.vertex.location ?? "").trim();
  const publisher = (config.vertex.publisher ?? "google").trim() || "google";

  if (!project || !location) {
    throw new ConfigError(
      [
        "Vertex backend requires a project and location.",
        "Set GEMINI_MCP_VERTEX_PROJECT (or GOOGLE_CLOUD_PROJECT) and GEMINI_MCP_VERTEX_LOCATION (or GOOGLE_CLOUD_LOCATION).",
      ].join(" "),
    );
  }

  const host = `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/${encodeURIComponent(publisher)}`;
}

export function resolvePrimaryApiBaseUrl(config: BridgeConfig): string {
  return config.backend === "vertex"
    ? resolveVertexApiBaseUrl(config)
    : config.apiBaseUrl;
}
