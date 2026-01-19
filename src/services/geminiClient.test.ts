import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiClient } from "./geminiClient.js";
import type { Logger } from "../logger.js";

describe("GeminiClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retries with API key on 401/403 when OAuth is configured and fallback is enabled", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url, headers });

        if (calls.length === 1) {
          expect(url).toBe("https://example.com/models?pageSize=1");
          expect(headers.Authorization).toBe("Bearer oauth-token");
          expect(headers["x-goog-api-key"]).toBeUndefined();
          return new Response(
            JSON.stringify({
              error: {
                message: "Request had insufficient authentication scopes.",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }

        expect(url).toBe("https://fallback.example.com/models?pageSize=1");
        expect(headers["x-goog-api-key"]).toBe("api-key");
        expect(headers.Authorization).toBeUndefined();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;

    const client = new GeminiClient(
      {
        accessToken: "oauth-token",
        apiKey: "api-key",
        allowApiKeyFallback: true,
        baseUrl: "https://example.com",
        apiKeyFallbackBaseUrl: "https://fallback.example.com",
        timeoutMs: 1000,
      },
      logger,
    );

    const result = await client.listModels<{ ok: boolean }>({ pageSize: 1 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(logger.debug).toHaveBeenCalledWith(
      "Retrying Gemini API request with API key",
      expect.objectContaining({ status: 403, path: "/models?pageSize=1" }),
    );

    expect(client.takeNotices()).toEqual([
      {
        type: "auth_fallback",
        from: "oauth",
        to: "apiKey",
        status: 403,
        message: "Request had insufficient authentication scopes.",
      },
    ]);
    expect(client.takeNotices()).toEqual([]);
  });

  it("accepts model names prefixed with models/", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const calls: string[] = [];
    globalThis.fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        calls.push(String(input));
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["x-goog-api-key"]).toBe("api-key");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;

    const client = new GeminiClient(
      {
        apiKey: "api-key",
        baseUrl: "https://example.com",
        timeoutMs: 1000,
      },
      logger,
    );

    const result = await client.generateContent<{ ok: boolean }>(
      "models/gemini-3-pro-preview",
      { contents: [] },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "https://example.com/models/gemini-3-pro-preview:generateContent",
    ]);
  });
});
