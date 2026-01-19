import { redactMeta, redactString } from "./utils/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function formatMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta_unserializable]";
  }
}

export function createStderrLogger(opts: { debugEnabled: boolean }): Logger {
  const write = (
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    if (level === "debug" && !opts.debugEnabled) return;
    // IMPORTANT: stderr only. Stdout is reserved for JSON-RPC over stdio.
    const safeMessage = redactString(message);
    const safeMeta = redactMeta(meta);
    process.stderr.write(`[${level}] ${safeMessage}${formatMeta(safeMeta)}\n`);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
