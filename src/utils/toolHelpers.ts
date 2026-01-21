import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { resolveGeminiAuth } from "../auth/resolveAuth.js";
import { GeminiClient } from "../services/geminiClient.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import {
  DailyTokenBudget,
  type BudgetReservation,
} from "../limits/dailyTokenBudget.js";
import { resolvePrimaryApiBaseUrl } from "./apiBaseUrls.js";
import { formatToolError } from "./toolErrors.js";
import { textBlock } from "./textBlock.js";
import { redactString } from "./redact.js";
import { isRecord } from "./typeGuards.js";

/**
 * Base tool dependencies required by most tools.
 * ConversationStore is optional as not all tools need it.
 */
export type ToolDependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

export function takeAuthFallbackWarnings(
  client: GeminiClient,
): ToolResult["content"] {
  const notices = client.takeNotices();
  const warnings: ToolResult["content"] = [];
  for (const notice of notices) {
    if (notice.type !== "auth_fallback") continue;
    const reason = redactString(
      `${notice.status}: ${notice.message || "OAuth/ADC request failed."}`,
    );
    warnings.push(
      textBlock(
        `Warning: Switched from OAuth/ADC (subscription) to API key for this request because OAuth/ADC failed (${reason}). This may incur API billing.`,
      ),
    );
  }
  return warnings;
}

/**
 * Validates that input doesn't exceed the configured character limit.
 * Returns an error ToolResult if validation fails, null otherwise.
 */
export function validateInputSize(
  input: string,
  maxChars: number,
  fieldName = "input",
  extraChars = 0,
): ToolResult | null {
  const extra =
    Number.isFinite(extraChars) && extraChars > 0 ? Math.trunc(extraChars) : 0;
  const totalChars = input.length + extra;
  if (totalChars > maxChars) {
    return {
      isError: true,
      content: [
        textBlock(
          `Request too large. Max ${fieldName} is ${maxChars} characters (set GEMINI_MCP_MAX_INPUT_CHARS to override).`,
        ),
      ],
    };
  }
  return null;
}

/**
 * Validates that maxTokens doesn't exceed the configured limit.
 * Returns an error ToolResult if validation fails, null otherwise.
 */
export function validateMaxTokens(
  maxTokens: number,
  limit: number,
): ToolResult | null {
  if (maxTokens > limit) {
    return {
      isError: true,
      content: [
        textBlock(
          `maxTokens exceeds configured limit (${limit}). Lower maxTokens, or raise the cap via GEMINI_MCP_MAX_TOKENS (or ~/.gemini-mcp-bridge/config.json: limits.maxTokensPerRequest).`,
        ),
      ],
    };
  }
  return null;
}

function looksLikeJsonSchema(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.includes("$schema") ||
    keys.includes("$ref") ||
    keys.includes("type") ||
    keys.includes("properties") ||
    keys.includes("items") ||
    keys.includes("anyOf") ||
    keys.includes("oneOf") ||
    keys.includes("allOf") ||
    keys.includes("enum") ||
    keys.includes("const") ||
    keys.includes("required") ||
    keys.includes("additionalProperties")
  );
}

/**
 * Accepts either a raw JSON Schema object, or a wrapper like:
 *   { name, schema: { ... }, strict }
 * and returns the schema object to send to Gemini (best-effort).
 */
export function normalizeResponseJsonSchema(
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  const schema = jsonSchema.schema;
  if (isRecord(schema) && !looksLikeJsonSchema(jsonSchema)) {
    return schema;
  }
  return jsonSchema;
}

/**
 * Creates a Gemini client with resolved authentication.
 */
export async function createGeminiClient(
  deps: ToolDependencies,
  timeoutMs?: number,
): Promise<GeminiClient> {
  const apiKeyBaseUrl = deps.config.apiBaseUrl;

  const authOpts = {
    mode: deps.config.auth.mode,
    apiKey: deps.config.auth.apiKey,
    apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
    apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
    apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
    apiKeyFilePaths: deps.config.auth.apiKeyFilePaths,
    oauthScopes: deps.config.auth.oauthScopes,
  } as const;

  const auth = await resolveGeminiAuth(authOpts);
  const resolvedTimeoutMs = timeoutMs ?? deps.config.timeoutMs;

  if (auth.type === "oauth") {
    const primaryBaseUrl = resolvePrimaryApiBaseUrl(deps.config);
    let fallbackApiKey: string | undefined;
    if (
      deps.config.auth.mode === "auto" &&
      deps.config.auth.fallbackPolicy !== "never"
    ) {
      try {
        const apiKeyAuth = await resolveGeminiAuth({
          ...authOpts,
          mode: "apiKey",
        });
        if (apiKeyAuth.type === "apiKey") {
          fallbackApiKey = apiKeyAuth.apiKey;
        }
      } catch {
        // No API key available for fallback
      }
    }
    return new GeminiClient(
      {
        backend: deps.config.backend,
        accessToken: auth.accessToken,
        apiKey: fallbackApiKey,
        allowApiKeyFallback:
          deps.config.auth.fallbackPolicy === "auto" && Boolean(fallbackApiKey),
        apiKeyFallbackPolicy: deps.config.auth.fallbackPolicy,
        apiKeyFallbackBaseUrl:
          deps.config.backend === "vertex" ? apiKeyBaseUrl : undefined,
        baseUrl: primaryBaseUrl,
        timeoutMs: resolvedTimeoutMs,
        quotaProject: deps.config.vertex.quotaProject,
      },
      deps.logger,
    );
  }

  return new GeminiClient(
    {
      backend: "developer",
      apiKey: auth.apiKey,
      baseUrl: apiKeyBaseUrl,
      timeoutMs: resolvedTimeoutMs,
    },
    deps.logger,
  );
}

/**
 * Checks both rate limit and budget before making an API call.
 * Throws if either limit is exceeded.
 */
export async function checkLimits(deps: ToolDependencies): Promise<void> {
  await deps.rateLimiter.checkOrThrow();
  await deps.dailyBudget.checkOrThrow();
}

/**
 * Wraps tool execution with standard error handling.
 * Logs errors and returns a formatted error result.
 */
export async function withToolErrorHandling<T>(
  toolName: string,
  deps: ToolDependencies,
  fn: () => Promise<T>,
): Promise<T | ToolResult> {
  try {
    return await fn();
  } catch (error) {
    deps.logger.error(`Error in ${toolName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    const { message } = formatToolError(error);
    return { isError: true, content: [textBlock(message)] };
  }
}

/**
 * Executes a function with budget reservation, automatically releasing on error.
 * Returns the function result or an error ToolResult.
 */
export async function withBudgetReservation<T>(
  deps: ToolDependencies,
  tokens: number,
  fn: (reservation: BudgetReservation) => Promise<T>,
): Promise<T> {
  const reservation = await deps.dailyBudget.reserve(tokens);
  try {
    return await fn(reservation);
  } catch (error) {
    // Release the reservation on error
    try {
      await deps.dailyBudget.release(reservation);
    } catch (releaseError) {
      deps.logger.warn("Failed to release budget reservation", {
        error:
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError),
      });
    }
    throw error;
  }
}
