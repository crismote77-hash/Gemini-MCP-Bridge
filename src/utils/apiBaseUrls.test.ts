import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { ConfigError } from "../errors.js";
import {
  resolvePrimaryApiBaseUrl,
  resolveVertexApiBaseUrl,
} from "./apiBaseUrls.js";

describe("apiBaseUrls", () => {
  const unusedConfigPath = () =>
    path.join(os.tmpdir(), `gemini-mcp-bridge-test-${randomUUID()}.json`);

  it("uses developer apiBaseUrl when backend=developer", () => {
    const config = loadConfig({
      env: { GEMINI_MCP_API_BASE_URL: "https://example.com/v1beta" },
      configPath: unusedConfigPath(),
    });
    expect(config.backend).toBe("developer");
    expect(resolvePrimaryApiBaseUrl(config)).toBe("https://example.com/v1beta");
  });

  it("uses explicit Vertex base URL when provided", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_BACKEND: "vertex",
        GEMINI_MCP_VERTEX_API_BASE_URL:
          "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google",
      },
      configPath: unusedConfigPath(),
    });
    expect(resolveVertexApiBaseUrl(config)).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google",
    );
    expect(resolvePrimaryApiBaseUrl(config)).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google",
    );
  });

  it("computes Vertex base URL from project/location/publisher", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_BACKEND: "vertex",
        GEMINI_MCP_VERTEX_PROJECT: "my-project",
        GEMINI_MCP_VERTEX_LOCATION: "us-central1",
        GEMINI_MCP_VERTEX_PUBLISHER: "google",
      },
      configPath: unusedConfigPath(),
    });
    expect(resolveVertexApiBaseUrl(config)).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google",
    );
  });

  it("throws ConfigError when Vertex project/location are missing", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_BACKEND: "vertex",
      },
      configPath: unusedConfigPath(),
    });
    expect(() => resolveVertexApiBaseUrl(config)).toThrow(ConfigError);
  });
});
