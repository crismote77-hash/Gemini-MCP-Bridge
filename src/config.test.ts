import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should return default values when no config is provided", () => {
    const config = loadConfig({ env: {} });
    expect(config.backend).toBe("developer");
    expect(config.apiBaseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(config.model).toBe("gemini-2.5-flash");
    expect(config.timeoutMs).toBe(30000);
    expect(config.generation.temperature).toBe(0.7);
    expect(config.auth.mode).toBe("auto");
    expect(config.auth.oauthScopes).toEqual([
      "https://www.googleapis.com/auth/generative-language",
    ]);
    expect(config.vertex.publisher).toBe("google");
  });

  it("should allow overriding timeoutMs via environment variable", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_TIMEOUT_MS: "60000",
      },
    });
    expect(config.timeoutMs).toBe(60000);
  });

  it("should throw error for invalid timeoutMs", () => {
    expect(() => {
      loadConfig({
        env: {
          GEMINI_MCP_TIMEOUT_MS: "invalid",
        },
      });
    }).toThrow("Invalid integer for GEMINI_MCP_TIMEOUT_MS");
  });

  it("should allow overriding model via environment variable", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_MODEL: "gemini-pro-vision",
      },
    });
    expect(config.model).toBe("gemini-pro-vision");
  });

  it("should allow configuring Vertex backend via env vars", () => {
    const config = loadConfig({
      env: {
        GEMINI_MCP_BACKEND: "vertex",
        GEMINI_MCP_VERTEX_PROJECT: "my-project",
        GEMINI_MCP_VERTEX_LOCATION: "us-central1",
      },
    });
    expect(config.backend).toBe("vertex");
    expect(config.vertex.project).toBe("my-project");
    expect(config.vertex.location).toBe("us-central1");
    expect(config.vertex.publisher).toBe("google");
  });
});
