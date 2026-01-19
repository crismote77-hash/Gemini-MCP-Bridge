import type { Logger } from "../logger.js";

export type GeminiClientConfig = {
  apiKey?: string;
  accessToken?: string;
  baseUrl: string;
  timeoutMs: number;
};

export class GeminiApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.data = data;
  }
}

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

export class GeminiClient {
  private readonly apiKey?: string;
  private readonly accessToken?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(config: GeminiClientConfig, logger: Logger) {
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs;
    this.logger = logger;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
      return headers;
    }
    if (this.apiKey) {
      headers["x-goog-api-key"] = this.apiKey;
      return headers;
    }
    throw new GeminiApiError("Missing Gemini authentication.", 401);
  }

  private async requestJson<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + opts.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: opts.method,
        headers: this.buildHeaders(),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const raw = await response.text();
      const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
      if (!response.ok) {
        const message =
          typeof parsed === "object" && parsed && "error" in parsed
            ? String((parsed as { error?: { message?: string } }).error?.message ?? raw)
            : raw || `HTTP ${response.status}`;
        throw new GeminiApiError(message, response.status, parsed);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof GeminiApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Gemini API request failed", { error: message, path: opts.path });
      throw new GeminiApiError(message, 500);
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateContent<T>(model: string, body: unknown): Promise<T> {
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(model)}:generateContent`,
      body,
    });
  }

  async countTokens<T>(model: string, body: unknown): Promise<T> {
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(model)}:countTokens`,
      body,
    });
  }

  async embedContent<T>(model: string, body: unknown): Promise<T> {
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(model)}:embedContent`,
      body,
    });
  }

  async listModels<T>(params: { pageSize?: number; pageToken?: string }): Promise<T> {
    const search = new URLSearchParams();
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    if (params.pageToken) search.set("pageToken", params.pageToken);
    const path = `/models${search.toString() ? `?${search.toString()}` : ""}`;
    return this.requestJson<T>({ method: "GET", path });
  }
}
