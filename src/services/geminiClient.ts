import type { Logger } from "../logger.js";

export type GeminiApiBackend = "developer" | "vertex";

export type GeminiClientConfig = {
  apiKey?: string;
  accessToken?: string;
  baseUrl: string;
  timeoutMs: number;
  allowApiKeyFallback?: boolean;
  apiKeyFallbackBaseUrl?: string;
  backend?: GeminiApiBackend;
};

export type GeminiClientNotice = {
  type: "auth_fallback";
  from: "oauth";
  to: "apiKey";
  status: number;
  message: string;
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
  readonly backend: GeminiApiBackend;
  private readonly apiKey?: string;
  private readonly accessToken?: string;
  private readonly baseUrl: string;
  private readonly apiKeyFallbackBaseUrl?: string;
  private readonly timeoutMs: number;
  private readonly allowApiKeyFallback: boolean;
  private readonly logger: Logger;
  private notices: GeminiClientNotice[] = [];

  constructor(config: GeminiClientConfig, logger: Logger) {
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.backend =
      config.backend ??
      (this.baseUrl.includes("aiplatform.googleapis.com")
        ? "vertex"
        : "developer");
    this.apiKeyFallbackBaseUrl = config.apiKeyFallbackBaseUrl
      ? config.apiKeyFallbackBaseUrl.replace(/\/$/, "")
      : undefined;
    this.timeoutMs = config.timeoutMs;
    this.allowApiKeyFallback = Boolean(config.allowApiKeyFallback);
    this.logger = logger;
  }

  takeNotices(): GeminiClientNotice[] {
    const notices = this.notices;
    this.notices = [];
    return notices;
  }

  private normalizeModelName(model: string): string {
    const trimmed = model.trim();
    return trimmed.startsWith("models/")
      ? trimmed.slice("models/".length)
      : trimmed;
  }

  private buildHeaders(
    prefer: "oauth" | "apiKey" = "oauth",
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const tryOAuth = () => {
      if (!this.accessToken) return false;
      headers.Authorization = `Bearer ${this.accessToken}`;
      return true;
    };

    const tryApiKey = () => {
      if (!this.apiKey) return false;
      headers["x-goog-api-key"] = this.apiKey;
      return true;
    };

    const ok =
      prefer === "apiKey"
        ? tryApiKey() || tryOAuth()
        : tryOAuth() || tryApiKey();

    if (ok) {
      return headers;
    }
    throw new GeminiApiError("Missing Gemini authentication.", 401);
  }

  private async requestJson<T>(opts: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const truncate = (value: string, maxChars: number): string => {
      const trimmed = value.trim();
      if (trimmed.length <= maxChars) return trimmed;
      return `${trimmed.slice(0, maxChars)}…`;
    };

    const attempt = async (prefer: "oauth" | "apiKey"): Promise<T> => {
      const baseUrl =
        prefer === "apiKey" && this.apiKeyFallbackBaseUrl
          ? this.apiKeyFallbackBaseUrl
          : this.baseUrl;
      const url = new URL(baseUrl + opts.path);
      const response = await fetch(url.toString(), {
        method: opts.method,
        headers: this.buildHeaders(prefer),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const raw = await response.text();
      let parsed: unknown = undefined;
      if (raw) {
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          const contentType = response.headers.get("content-type") ?? "";
          const snippet = truncate(raw, 200);
          const contentTypeLabel = contentType
            ? `; content-type ${contentType}`
            : "";
          const snippetLabel = snippet
            ? ` Body starts with: ${JSON.stringify(snippet)}.`
            : "";
          throw new GeminiApiError(
            `Non-JSON response from Gemini API (HTTP ${response.status}${contentTypeLabel}).${snippetLabel}`,
            response.status,
            { contentType, snippet },
          );
        }
      }
      if (!response.ok) {
        const message = (() => {
          if (typeof parsed === "object" && parsed && "error" in parsed) {
            const parsedMessage = (parsed as { error?: { message?: string } })
              .error?.message;
            if (parsedMessage && parsedMessage.trim()) return parsedMessage;
          }
          return raw ? truncate(raw, 500) : `HTTP ${response.status}`;
        })();
        throw new GeminiApiError(message, response.status, parsed);
      }
      return parsed as T;
    };

    try {
      if (!this.accessToken) {
        return await attempt("apiKey");
      }

      try {
        return await attempt("oauth");
      } catch (error) {
        const primaryError = error;
        const shouldRetry =
          this.allowApiKeyFallback &&
          this.apiKey &&
          primaryError instanceof GeminiApiError &&
          (primaryError.status === 401 ||
            primaryError.status === 403 ||
            primaryError.status === 429 ||
            primaryError.status === 402);
        if (!shouldRetry) throw primaryError;

        this.logger.debug("Retrying Gemini API request with API key", {
          status: primaryError.status,
          path: opts.path,
        });

        const result = await attempt("apiKey");
        this.notices.push({
          type: "auth_fallback",
          from: "oauth",
          to: "apiKey",
          status: primaryError.status,
          message: primaryError.message || "",
        });
        return result;
      }
    } catch (error) {
      if (error instanceof GeminiApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Gemini API request failed", {
        error: message,
        path: opts.path,
      });
      throw new GeminiApiError(message, 500);
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateContent<T>(model: string, body: unknown): Promise<T> {
    const normalizedModel = this.normalizeModelName(model);
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(normalizedModel)}:generateContent`,
      body,
    });
  }

  async *streamGenerateContent<T>(
    model: string,
    body: unknown,
    opts?: { signal?: AbortSignal },
  ): AsyncGenerator<T, void, void> {
    const normalizedModel = this.normalizeModelName(model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const onAbort = () => controller.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const truncate = (value: string, maxChars: number): string => {
      const trimmed = value.trim();
      if (trimmed.length <= maxChars) return trimmed;
      return `${trimmed.slice(0, maxChars)}…`;
    };

    const start = async (prefer: "oauth" | "apiKey"): Promise<Response> => {
      const baseUrl =
        prefer === "apiKey" && this.apiKeyFallbackBaseUrl
          ? this.apiKeyFallbackBaseUrl
          : this.baseUrl;
      const url = new URL(
        baseUrl +
          `/models/${encodeURIComponent(normalizedModel)}:streamGenerateContent`,
      );
      const headers = this.buildHeaders(prefer);
      headers.Accept = "text/event-stream";
      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const raw = await response.text();
        let parsed: unknown = undefined;
        if (raw) {
          try {
            parsed = JSON.parse(raw) as unknown;
          } catch {
            const contentType = response.headers.get("content-type") ?? "";
            const snippet = truncate(raw, 200);
            const contentTypeLabel = contentType
              ? `; content-type ${contentType}`
              : "";
            const snippetLabel = snippet
              ? ` Body starts with: ${JSON.stringify(snippet)}.`
              : "";
            throw new GeminiApiError(
              `Non-JSON response from Gemini API (HTTP ${response.status}${contentTypeLabel}).${snippetLabel}`,
              response.status,
              { contentType, snippet },
            );
          }
        }
        const message = (() => {
          if (typeof parsed === "object" && parsed && "error" in parsed) {
            const parsedMessage = (parsed as { error?: { message?: string } })
              .error?.message;
            if (parsedMessage && parsedMessage.trim()) return parsedMessage;
          }
          return raw ? truncate(raw, 500) : `HTTP ${response.status}`;
        })();
        throw new GeminiApiError(message, response.status, parsed);
      }

      if (!response.body) {
        throw new GeminiApiError(
          "Empty response body from Gemini streaming API.",
          500,
        );
      }

      return response;
    };

    try {
      const response = await (async (): Promise<Response> => {
        if (!this.accessToken) return start("apiKey");
        try {
          return await start("oauth");
        } catch (error) {
          const primaryError = error;
          const shouldRetry =
            this.allowApiKeyFallback &&
            this.apiKey &&
            primaryError instanceof GeminiApiError &&
            (primaryError.status === 401 ||
              primaryError.status === 403 ||
              primaryError.status === 429 ||
              primaryError.status === 402);
          if (!shouldRetry) throw primaryError;

          this.logger.debug("Retrying Gemini streaming request with API key", {
            status: primaryError.status,
            path: `/models/${normalizedModel}:streamGenerateContent`,
          });

          const fallback = await start("apiKey");
          this.notices.push({
            type: "auth_fallback",
            from: "oauth",
            to: "apiKey",
            status: primaryError.status,
            message: primaryError.message || "",
          });
          return fallback;
        }
      })();

      if (!response.body) {
        throw new GeminiApiError(
          "Empty response body from Gemini streaming API.",
          500,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawSseData = false;
      let finished = false;

      const emitJson = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        if (trimmed === "[DONE]") {
          finished = true;
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as T;
          return parsed;
        } catch (error) {
          const snippet = truncate(trimmed, 200);
          const message =
            error instanceof Error ? error.message : String(error);
          throw new GeminiApiError(
            `Non-JSON event from Gemini streaming API: ${message}. Body starts with: ${JSON.stringify(snippet)}.`,
            500,
            { snippet },
          );
        }
      };

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const idxLf = buffer.indexOf("\n\n");
          const idxCrLf = buffer.indexOf("\r\n\r\n");
          const idx =
            idxCrLf !== -1 && (idxLf === -1 || idxCrLf < idxLf)
              ? idxCrLf
              : idxLf;
          if (idx === -1) break;
          const delimiterLength = idx === idxCrLf ? 4 : 2;
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + delimiterLength);

          const lines = rawEvent.split(/\r?\n/);
          const dataLines = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trimStart());
          if (dataLines.length === 0) continue;
          sawSseData = true;

          const data = dataLines.join("\n");
          const parsed = emitJson(data);
          if (finished) break;
          if (parsed !== undefined) yield parsed;
        }
      }

      if (!finished) buffer += decoder.decode();

      if (sawSseData) {
        const leftover = buffer.trim();
        if (leftover) {
          const lines = leftover.split(/\r?\n/);
          const dataLines = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trimStart());
          if (dataLines.length > 0) {
            const data = dataLines.join("\n");
            const parsed = emitJson(data);
            if (!finished && parsed !== undefined) yield parsed;
          }
        }
        return;
      }

      const trimmed = buffer.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            yield item as T;
          }
          return;
        }
        yield parsed as T;
      } catch (error) {
        const snippet = truncate(trimmed, 200);
        const message = error instanceof Error ? error.message : String(error);
        throw new GeminiApiError(
          `Non-JSON response from Gemini streaming API: ${message}. Body starts with: ${JSON.stringify(snippet)}.`,
          500,
          { snippet },
        );
      }
    } catch (error) {
      if (error instanceof GeminiApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Gemini streaming request failed", { error: message });
      throw new GeminiApiError(message, 500);
    } finally {
      clearTimeout(timeout);
      if (opts?.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async countTokens<T>(model: string, body: unknown): Promise<T> {
    const normalizedModel = this.normalizeModelName(model);
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(normalizedModel)}:countTokens`,
      body,
    });
  }

  async embedContent<T>(model: string, body: unknown): Promise<T> {
    const normalizedModel = this.normalizeModelName(model);
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(normalizedModel)}:embedContent`,
      body,
    });
  }

  async predict<T>(model: string, body: unknown): Promise<T> {
    const normalizedModel = this.normalizeModelName(model);
    return this.requestJson<T>({
      method: "POST",
      path: `/models/${encodeURIComponent(normalizedModel)}:predict`,
      body,
    });
  }

  async listModels<T>(params: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<T> {
    const search = new URLSearchParams();
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    if (params.pageToken) search.set("pageToken", params.pageToken);
    const path = `/models${search.toString() ? `?${search.toString()}` : ""}`;
    try {
      return await this.requestJson<T>({ method: "GET", path });
    } catch (error) {
      if (
        this.backend !== "vertex" ||
        !(error instanceof GeminiApiError) ||
        error.status !== 404
      ) {
        throw error;
      }

      for (const fallbackBaseUrl of this.vertexListModelsFallbackBaseUrls()) {
        if (fallbackBaseUrl === this.baseUrl) continue;
        const fallbackClient = this.cloneWithBaseUrl(fallbackBaseUrl);
        try {
          return await fallbackClient.requestJson<T>({ method: "GET", path });
        } catch (fallbackError) {
          if (
            fallbackError instanceof GeminiApiError &&
            fallbackError.status === 404
          ) {
            continue;
          }
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  private cloneWithBaseUrl(baseUrl: string): GeminiClient {
    return new GeminiClient(
      {
        backend: this.backend,
        apiKey: this.apiKey,
        accessToken: this.accessToken,
        allowApiKeyFallback: this.allowApiKeyFallback,
        apiKeyFallbackBaseUrl: this.apiKeyFallbackBaseUrl,
        baseUrl,
        timeoutMs: this.timeoutMs,
      },
      this.logger,
    );
  }

  private vertexListModelsFallbackBaseUrls(): string[] {
    let parsed: URL;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      return [];
    }

    const host = parsed.host;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const version = parts[0];

    const idxLocations = parts.indexOf("locations");
    const location = idxLocations !== -1 ? (parts[idxLocations + 1] ?? "") : "";
    const idxPublishers = parts.indexOf("publishers");
    const publisher =
      idxPublishers !== -1 ? (parts[idxPublishers + 1] ?? "") : "";

    const globalHost = "aiplatform.googleapis.com";
    const regionHost = location
      ? `${location}-aiplatform.googleapis.com`
      : host;

    const versions: string[] = [];
    if (version) versions.push(version);
    if (version === "v1") versions.push("v1beta1");

    const seen = new Set<string>();
    const out: string[] = [];
    const add = (nextHost: string, pathnameParts: string[]) => {
      const candidate = `https://${nextHost}/${pathnameParts.join("/")}`;
      if (seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
    };

    for (const v of versions) {
      if (parts.length > 0) {
        const replaced = [...parts];
        replaced[0] = v;
        add(regionHost, replaced);
        add(globalHost, replaced);
      }
      if (location && publisher) {
        add(regionHost, [v, "publishers", publisher]);
        add(globalHost, [v, "publishers", publisher]);
        add(regionHost, [v, "locations", location, "publishers", publisher]);
        add(globalHost, [v, "locations", location, "publishers", publisher]);
      }
    }

    return out;
  }
}
