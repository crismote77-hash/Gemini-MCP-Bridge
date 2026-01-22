import crypto from "node:crypto";

/**
 * Patterns for sensitive data that should be redacted
 */
const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-... and sk-proj-...)
  {
    pattern: /sk-(?:proj-)?[a-zA-Z0-9]{20,}/g,
    replacement: "sk-***REDACTED***",
  },
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9-]+/g, replacement: "sk-ant-***REDACTED***" },
  // Tavily API keys
  { pattern: /tvly-[a-zA-Z0-9]+/g, replacement: "tvly-***REDACTED***" },
  // Google API keys
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replacement: "AIza***REDACTED***" },
  // AWS access keys
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "AKIA***REDACTED***" },
  // GitHub tokens
  { pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: "gh*_***REDACTED***" },
  // Generic API keys
  {
    pattern: /api[_-]?key["\s:=]+["']?[a-zA-Z0-9_-]{20,}["']?/gi,
    replacement: "api_key=***REDACTED***",
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+[a-zA-Z0-9._-]+/gi,
    replacement: "Bearer ***REDACTED***",
  },
  // Authorization headers (value part excludes spaces to prevent over-matching)
  {
    pattern: /Authorization["\s:=]+["']?[a-zA-Z0-9._-]+["']?/gi,
    replacement: "Authorization: ***REDACTED***",
  },
  // Password patterns
  {
    pattern: /password["\s:=]+["']?[^"'\s,}]+["']?/gi,
    replacement: "password=***REDACTED***",
  },
  // Token patterns
  {
    pattern: /token["\s:=]+["']?[a-zA-Z0-9._-]{20,}["']?/gi,
    replacement: "token=***REDACTED***",
  },
  // Secret patterns
  {
    pattern: /secret["\s:=]+["']?[^"'\s,}]+["']?/gi,
    replacement: "secret=***REDACTED***",
  },
  // Private key headers
  {
    pattern:
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "***PRIVATE_KEY_REDACTED***",
  },
  // Base64-encoded credentials (basic auth)
  {
    pattern: /Basic\s+[a-zA-Z0-9+/=]{20,}/gi,
    replacement: "Basic ***REDACTED***",
  },
];

/**
 * Redact sensitive patterns from a string
 */
export function redactSensitiveString(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Generate a stable hash for correlation (truncated SHA256)
 */
export function generateStableHash(input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return hash.slice(0, 16); // First 16 chars for brevity
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncateString(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 3) + "...";
}

/**
 * Sanitize tool arguments for logging - extract metadata without sensitive content
 */
export function sanitizeToolArgs(
  args: Record<string, unknown>,
  level: "errors" | "debug" | "full",
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    // Always redact known sensitive keys
    if (["apiKey", "token", "password", "secret"].includes(key)) {
      sanitized[key] = "***REDACTED***";
      continue;
    }

    if (typeof value === "string") {
      // Handle string values based on logging level
      if (key === "prompt" || key === "diff" || key === "content") {
        // These are potentially sensitive content fields
        sanitized[`${key}Length`] = value.length;
        sanitized[`${key}Hash`] = generateStableHash(value);

        if (level === "debug") {
          // Include truncated, redacted preview
          const redacted = redactSensitiveString(value);
          sanitized[`${key}Preview`] = truncateString(redacted, 100);
        } else if (level === "full") {
          // Include full redacted content
          sanitized[key] = redactSensitiveString(value);
        }
      } else {
        // Normal strings
        sanitized[key] = redactSensitiveString(value);
      }
    } else if (Array.isArray(value)) {
      // Recursively sanitize arrays
      sanitized[key] = value.map((item) => {
        if (typeof item === "object" && item !== null) {
          return sanitizeToolArgs(item as Record<string, unknown>, level);
        }
        if (typeof item === "string") {
          return redactSensitiveString(item);
        }
        return item;
      });
    } else if (typeof value === "object" && value !== null) {
      // Recursively sanitize objects
      sanitized[key] = sanitizeToolArgs(
        value as Record<string, unknown>,
        level,
      );
    } else {
      // Primitives
      sanitized[key] = value;
    }
  }

  return sanitized;
}
