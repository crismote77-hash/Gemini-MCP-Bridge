import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { ConfigError } from "../errors.js";
import {
  resolvePrimaryApiBaseUrl,
  resolveVertexApiBaseUrl,
} from "./apiBaseUrls.js";

describe("apiBaseUrls", () => {
  it("uses developer apiBaseUrl when backend=developer", () => {
    const config = loadConfig({
      env: { GEMINI_MCP_API_BASE_URL: "https://example.com/v1beta" },
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
    });
    expect(() => resolveVertexApiBaseUrl(config)).toThrow(ConfigError);
  });
});
