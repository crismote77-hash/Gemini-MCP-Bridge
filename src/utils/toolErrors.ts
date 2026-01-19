import { AuthError } from "../auth/resolveAuth.js";
import { BudgetError } from "../limits/dailyTokenBudget.js";
import { RateLimitError as LocalRateLimitError } from "../limits/rateLimiter.js";
import { GeminiApiError } from "../services/geminiClient.js";

export type ToolErrorInfo = { message: string };

export function formatToolError(error: unknown): ToolErrorInfo {
  if (error instanceof AuthError) {
    return {
      message:
        "Gemini API authentication failed. Use OAuth (gcloud auth application-default login) or set GEMINI_API_KEY (or GOOGLE_API_KEY) or GEMINI_API_KEY_FILE.",
    };
  }

  if (error instanceof LocalRateLimitError) {
    return { message: "Rate limit exceeded. Wait a minute and retry." };
  }

  if (error instanceof BudgetError) {
    return {
      message:
        "Daily token budget exceeded. Reduce usage or increase GEMINI_MCP_DAILY_TOKEN_LIMIT in config.",
    };
  }

  if (error instanceof GeminiApiError) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return { message: "Gemini API authentication failed. Check your credentials and permissions." };
    }
    if (status === 429) {
      return { message: "Gemini API rate limit exceeded. Wait and retry." };
    }
    if (status >= 500) {
      return { message: `Gemini API error (${status}). Try again later.` };
    }
    return { message: error.message || `Gemini API error (${status}).` };
  }

  if (error instanceof Error) {
    return { message: "Unexpected error. Check server logs for details." };
  }

  return { message: "Unexpected error. Check server logs for details." };
}
