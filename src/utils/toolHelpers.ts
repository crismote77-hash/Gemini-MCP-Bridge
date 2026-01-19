import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { resolveGeminiAuth } from "../auth/resolveAuth.js";
import { GeminiClient } from "../services/geminiClient.js";
import { RateLimiter } from "../limits/rateLimiter.js";
import { DailyTokenBudget, type BudgetReservation } from "../limits/dailyTokenBudget.js";
import { formatToolError } from "./toolErrors.js";
import { textBlock } from "./textBlock.js";

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

/**
 * Validates that input doesn't exceed the configured character limit.
 * Returns an error ToolResult if validation fails, null otherwise.
 */
export function validateInputSize(
  input: string,
  maxChars: number,
  fieldName = "input"
): ToolResult | null {
  if (input.length > maxChars) {
    return {
      isError: true,
      content: [
        textBlock(
          `Request too large. Max ${fieldName} is ${maxChars} characters (set GEMINI_MCP_MAX_INPUT_CHARS to override).`
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
  limit: number
): ToolResult | null {
  if (maxTokens > limit) {
    return {
      isError: true,
      content: [textBlock(`maxTokens exceeds configured limit (${limit}).`)],
    };
  }
  return null;
}

/**
 * Creates a Gemini client with resolved authentication.
 */
export async function createGeminiClient(deps: ToolDependencies, timeoutMs?: number): Promise<GeminiClient> {
  const auth = await resolveGeminiAuth({
    mode: deps.config.auth.mode,
    apiKey: deps.config.auth.apiKey,
    apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
    apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
    apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
    oauthScopes: deps.config.auth.oauthScopes,
  });
  const clientConfig =
    auth.type === "oauth"
      ? { accessToken: auth.accessToken, baseUrl: deps.config.apiBaseUrl, timeoutMs: timeoutMs ?? deps.config.timeoutMs }
      : { apiKey: auth.apiKey, baseUrl: deps.config.apiBaseUrl, timeoutMs: timeoutMs ?? deps.config.timeoutMs };
  return new GeminiClient(clientConfig, deps.logger);
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
  fn: () => Promise<T>
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
  fn: (reservation: BudgetReservation) => Promise<T>
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
        error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      });
    }
    throw error;
  }
}

/**
 * Estimates token count from character length.
 * Uses a rough estimate of 4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
