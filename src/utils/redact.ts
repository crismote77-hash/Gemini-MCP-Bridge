const SENSITIVE_KEY_FRAGMENTS = [
  "token",
  "apikey",
  "api_key",
  "secret",
  "authorization",
  "access_token",
  "refresh_token",
];

const REDACTED = "[redacted]";

export function redactString(input: string): string {
  let output = input;
  output = output.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]");
  output = output.replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza[redacted]");
  output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  output = output.replace(/([a-z][a-z0-9+.-]*:\/\/)([^@/\s]+)@/gi, "$1[redacted]@");
  output = output.replace(/(access_token|refresh_token|api_key|token)\s*[=:]\s*[^\s,]+/gi, "$1=[redacted]");
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEY_FRAGMENTS.some((frag) => lower.includes(frag))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(val);
    }
  }
  return out;
}

export function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return redactValue(meta) as Record<string, unknown>;
}
