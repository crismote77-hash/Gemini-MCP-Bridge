import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGeminiAuth } from "./resolveAuth.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-mcp-bridge-auth-"));
}

function writeAdcUserCreds(dir: string): string {
  const filePath = path.join(dir, "application_default_credentials.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        type: "authorized_user",
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        refresh_token: "test-refresh-token",
      },
      null,
      2,
    ),
    "utf8",
  );
  return filePath;
}

describe("resolveGeminiAuth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("prefers explicit OAuth token override in auto mode", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const auth = await resolveGeminiAuth({
      mode: "auto",
      apiKeyEnvVar: "GEMINI_API_KEY",
      apiKeyEnvVarAlt: "GOOGLE_API_KEY",
      apiKeyFileEnvVar: "GEMINI_API_KEY_FILE",
      oauthScopes: ["https://www.googleapis.com/auth/generative-language"],
      env: {
        GEMINI_MCP_OAUTH_TOKEN: "test-oauth-token",
        GEMINI_API_KEY: "test-api-key",
      },
    });

    expect(auth).toEqual({
      type: "oauth",
      accessToken: "test-oauth-token",
      source: "env_token",
    });
  });

  it("falls back to API key in auto mode when OAuth is unavailable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const auth = await resolveGeminiAuth({
      mode: "auto",
      apiKeyEnvVar: "GEMINI_API_KEY",
      apiKeyEnvVarAlt: "GOOGLE_API_KEY",
      apiKeyFileEnvVar: "GEMINI_API_KEY_FILE",
      oauthScopes: ["https://www.googleapis.com/auth/generative-language"],
      env: {
        GEMINI_API_KEY: "test-api-key",
        GOOGLE_APPLICATION_CREDENTIALS: "/nope/does-not-exist.json",
      },
    });

    expect(auth).toEqual({
      type: "apiKey",
      apiKey: "test-api-key",
      source: "env",
    });
  });

  it("prefers ADC over API key in auto mode when both are present", async () => {
    const dir = makeTempDir();
    const credsPath = writeAdcUserCreds(dir);

    globalThis.fetch = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://oauth2.googleapis.com/token");
      return new Response(
        JSON.stringify({ access_token: "adc-access-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const auth = await resolveGeminiAuth({
      mode: "auto",
      apiKeyEnvVar: "GEMINI_API_KEY",
      apiKeyEnvVarAlt: "GOOGLE_API_KEY",
      apiKeyFileEnvVar: "GEMINI_API_KEY_FILE",
      oauthScopes: ["https://www.googleapis.com/auth/generative-language"],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: credsPath,
        GEMINI_API_KEY: "test-api-key",
      },
    });

    expect(auth).toEqual({
      type: "oauth",
      accessToken: "adc-access-token",
      source: "adc_user",
    });
  });
});
