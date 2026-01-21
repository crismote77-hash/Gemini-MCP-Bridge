import { AuthError } from "../auth/resolveAuth.js";
import { ConfigError } from "../errors.js";
import {
  BudgetApprovalRequiredError,
  BudgetError,
} from "../limits/dailyTokenBudget.js";
import { RateLimitError as LocalRateLimitError } from "../limits/rateLimiter.js";
import {
  ApiKeyFallbackPromptError,
  GeminiApiError,
} from "../services/geminiClient.js";
import { redactString } from "./redact.js";

export type ToolErrorInfo = { message: string };

function looksLikeQuotaOrCreditsIssue(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("quota") ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("exceeded") ||
    normalized.includes("daily") ||
    normalized.includes("credit") ||
    normalized.includes("billing") ||
    normalized.includes("payment") ||
    normalized.includes("insufficient funds")
  );
}

function formatApiKeySetupGuidance(): string {
  return [
    "To continue, configure an API key (this may incur API billing):",
    "1) Create a key: https://ai.google.dev/gemini-api/docs/api-key",
    "2) Save it to ~/.gemini-mcp-bridge/api-key (or /etc/gemini-mcp-bridge/api-key for shared use)",
    "3) Or export it: GEMINI_API_KEY=... (or GOOGLE_API_KEY)",
    "4) Restart gemini-mcp-bridge (keep GEMINI_MCP_AUTH_MODE=auto for OAuth-first fallback).",
  ].join("\n");
}

export function formatToolError(error: unknown): ToolErrorInfo {
  if (error instanceof ConfigError) {
    return { message: error.message || "Configuration error." };
  }

  if (error instanceof AuthError) {
    return {
      message:
        "Gemini API authentication failed. Use OAuth (gcloud auth application-default login) or set GEMINI_API_KEY (or GOOGLE_API_KEY) or GEMINI_API_KEY_FILE.",
    };
  }

  if (error instanceof LocalRateLimitError) {
    return { message: "Rate limit exceeded. Wait a minute and retry." };
  }

  if (error instanceof BudgetApprovalRequiredError) {
    const increment = error.incrementTokens;
    return {
      message:
        `Token budget reached (${error.usedTokens}/${error.maxTokens}). ` +
        `Approve another ${increment} tokens for today:\n` +
        "1) Run gemini-mcp-bridge --approve-budget\n" +
        "2) Retry your request.",
    };
  }

  if (error instanceof BudgetError) {
    return {
      message:
        "Token budget exceeded (bridge safety limit). Reduce usage or increase GEMINI_MCP_DAILY_TOKEN_LIMIT in config.",
    };
  }

  if (error instanceof ApiKeyFallbackPromptError) {
    const rawMessage = redactString((error.message || "").trim());
    const detail = rawMessage ? ` (${rawMessage})` : "";
    return {
      message:
        `OAuth/ADC request failed${detail}. An API key is available, but fallback requires approval.\n\n` +
        "To approve fallback:\n" +
        "1) Run gemini-mcp-bridge --setup and choose API key fallback = auto\n" +
        "2) Or set GEMINI_MCP_AUTH_FALLBACK=auto\n" +
        "3) Restart your MCP client and retry.",
    };
  }

  if (error instanceof GeminiApiError) {
    const status = error.status;
    const rawMessage = redactString((error.message || "").trim());
    const normalized = rawMessage.toLowerCase();

    const looksLikeSchemaBug =
      normalized.includes("properties") &&
      (normalized.includes("cannot read properties of undefined") ||
        (normalized.includes("cannot read property") &&
          normalized.includes("of undefined")) ||
        normalized.includes("undefined (reading 'properties')") ||
        normalized.includes('undefined (reading "properties")'));
    if (looksLikeSchemaBug) {
      return {
        message:
          "Gemini API failed while applying your jsonSchema for structured output. Try omitting jsonSchema, or use a simple JSON Schema object (type: object + properties/required). Also ensure the chosen model supports JSON mode (gemini_list_models filter=json_mode).",
      };
    }

    if (status === 401 || status === 403) {
      if (normalized.includes("missing gemini authentication")) {
        return {
          message:
            "Missing Gemini credentials. Use OAuth (gcloud auth application-default login) or set GEMINI_API_KEY (or GOOGLE_API_KEY) or GEMINI_API_KEY_FILE.",
        };
      }
      if (normalized.includes("insufficient authentication scopes")) {
        return {
          message:
            "OAuth token has insufficient scopes for the configured API. If you are using OAuth/ADC (subscription) credentials (cloud-platform scope), set GEMINI_MCP_BACKEND=vertex and configure GEMINI_MCP_VERTEX_PROJECT and GEMINI_MCP_VERTEX_LOCATION. Otherwise, re-run gcloud auth application-default login with the required scopes (see GEMINI_MCP_OAUTH_SCOPES) or use an API key (GEMINI_API_KEY / GOOGLE_API_KEY).",
        };
      }
      if (looksLikeQuotaOrCreditsIssue(normalized)) {
        const detail = rawMessage ? ` (${rawMessage})` : "";
        return {
          message: `Gemini OAuth/ADC (subscription) quota/credits appear exhausted${detail}.\n\n${formatApiKeySetupGuidance()}`,
        };
      }
      if (normalized.includes("api key not valid")) {
        return {
          message:
            "Gemini API key was rejected. Check GEMINI_API_KEY / GOOGLE_API_KEY (or GEMINI_API_KEY_FILE), or switch to OAuth (gcloud auth application-default login).",
        };
      }
      return {
        message: rawMessage
          ? `Gemini API authentication failed: ${rawMessage}`
          : "Gemini API authentication failed. Check your credentials and permissions.",
      };
    }
    if (status === 402) {
      const detail = rawMessage ? ` (${rawMessage})` : "";
      return {
        message: `Gemini API billing/credits issue${detail}.\n\n${formatApiKeySetupGuidance()}`,
      };
    }
    if (status === 429) {
      const detail = rawMessage ? ` (${rawMessage})` : "";
      return {
        message: `Gemini API quota/rate limit exceeded${detail}.\n\n${formatApiKeySetupGuidance()}`,
      };
    }
    if (status >= 500) {
      return { message: `Gemini API error (${status}). Try again later.` };
    }
    return { message: rawMessage || `Gemini API error (${status}).` };
  }

  if (error instanceof Error) {
    const message = redactString((error.message || "").trim());
    if (message) {
      const maxLen = 500;
      return {
        message:
          message.length > maxLen ? `${message.slice(0, maxLen)}…` : message,
      };
    }
    return { message: "Unexpected error. Check server logs for details." };
  }

  return { message: "Unexpected error. Check server logs for details." };
}
