import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  resolveLogDirectory,
  ensureLogDirectory,
  getCurrentLogPath,
  getRotatedLogPath,
  isWSL,
} from "../utils/logPaths.js";
import {
  sanitizeToolArgs,
  redactSensitiveString,
} from "../utils/redactForLog.js";

export type LogLevel = "off" | "errors" | "debug" | "full";

export interface ErrorLogConfig {
  errorLogging: LogLevel;
  directory?: string;
  maxFileSizeMb: number;
  retentionDays: number;
}

export interface ErrorLogEntry {
  timestamp: string;
  level: "ERROR" | "WARNING" | "INFO";
  mcpVersion: string;
  sessionId: string;
  requestId?: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  clientName?: string;
  clientVersion?: string;
  aiModel?: string;
  osInfo: {
    platform: string;
    release: string;
    arch: string;
    isWSL: boolean;
  };
  errorType: string;
  message: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  redacted: boolean;
}

// Package version - will be set during initialization
let mcpVersion = "unknown";

// Session ID - unique per server instance
const sessionId = randomUUID();

// WSL hint shown flag
let wslHintShown = false;

/**
 * Set the MCP version (call from index.ts during startup)
 */
export function setMcpVersion(version: string): void {
  mcpVersion = version;
}

/**
 * Get OS info for logging
 */
function getOsInfo(): ErrorLogEntry["osInfo"] {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    isWSL: isWSL(),
  };
}

/**
 * Check if log file needs rotation based on date
 */
function needsDateRotation(logPath: string): boolean {
  if (!fs.existsSync(logPath)) return false;

  const stats = fs.statSync(logPath);
  const fileDate = stats.mtime.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  return fileDate !== today;
}

/**
 * Check if log file needs rotation based on size
 */
function needsSizeRotation(logPath: string, maxSizeMb: number): boolean {
  if (!fs.existsSync(logPath)) return false;

  const stats = fs.statSync(logPath);
  const maxBytes = maxSizeMb * 1024 * 1024;

  return stats.size >= maxBytes;
}

/**
 * Rotate the current log file
 */
function rotateLogFile(logDir: string, currentPath: string): void {
  if (!fs.existsSync(currentPath)) return;

  const stats = fs.statSync(currentPath);
  const rotatedPath = getRotatedLogPath(logDir, stats.mtime);

  // Handle case where rotated file already exists (multiple rotations same day)
  let finalPath = rotatedPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const base = rotatedPath.replace(".log", "");
    finalPath = `${base}-${counter}.log`;
    counter++;
  }

  fs.renameSync(currentPath, finalPath);
}

/**
 * Clean up old log files based on retention policy
 */
function cleanupOldLogs(logDir: string, retentionDays: number): void {
  if (!fs.existsSync(logDir)) return;

  const now = Date.now();
  const maxAge = retentionDays * 24 * 60 * 60 * 1000;

  const files = fs.readdirSync(logDir);
  for (const file of files) {
    // Only clean up rotated files (mcp-errors-YYYY-MM-DD.log)
    if (!file.match(/^mcp-errors-\d{4}-\d{2}-\d{2}(-\d+)?\.log$/)) continue;

    const filePath = path.join(logDir, file);
    const stats = fs.statSync(filePath);

    if (now - stats.mtime.getTime() > maxAge) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Show WSL hint if applicable (one-time)
 */
function maybeShowWslHint(
  logDir: string,
  logger: { info: (msg: string) => void },
): void {
  if (wslHintShown || !isWSL()) return;

  wslHintShown = true;
  logger.info(
    `Running in WSL. Error logs at: ${logDir}\n` +
      `  For Windows access, set GEMINI_MCP_LOG_DIR=/mnt/c/Users/<user>/AppData/Local/gemini-mcp-bridge/logs`,
  );
}

/**
 * Error Logger class for centralized error logging
 */
export class ErrorLogger {
  private config: ErrorLogConfig;
  private logDir: string;
  private logPath: string;
  private initialized = false;
  private stderrLogger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };

  constructor(
    config: ErrorLogConfig,
    stderrLogger: { info: (msg: string) => void; error: (msg: string) => void },
  ) {
    this.config = config;
    this.stderrLogger = stderrLogger;
    this.logDir = resolveLogDirectory(config.directory);
    this.logPath = getCurrentLogPath(this.logDir);
  }

  /**
   * Initialize the error logger (create directory, rotate if needed)
   */
  initialize(): void {
    if (this.initialized || this.config.errorLogging === "off") return;

    try {
      ensureLogDirectory(this.logDir);

      // Check for rotation on startup
      if (needsDateRotation(this.logPath)) {
        rotateLogFile(this.logDir, this.logPath);
      }

      // Cleanup old logs
      cleanupOldLogs(this.logDir, this.config.retentionDays);

      // Show WSL hint if applicable
      maybeShowWslHint(this.logDir, this.stderrLogger);

      this.initialized = true;
    } catch (error) {
      // Don't let logging initialization failures break the server
      this.stderrLogger.error(
        `Failed to initialize error logger: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Log an error
   */
  logError(opts: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    error: Error | unknown;
    requestId?: string;
    clientName?: string;
    clientVersion?: string;
    aiModel?: string;
    context?: Record<string, unknown>;
  }): void {
    if (this.config.errorLogging === "off") return;

    try {
      this.initialize();

      // Check size rotation before writing
      if (needsSizeRotation(this.logPath, this.config.maxFileSizeMb)) {
        rotateLogFile(this.logDir, this.logPath);
      }

      const error = opts.error;
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      const level = this.config.errorLogging as "errors" | "debug" | "full";

      const entry: ErrorLogEntry = {
        timestamp: new Date().toISOString(),
        level: "ERROR",
        mcpVersion,
        sessionId,
        requestId: opts.requestId,
        toolName: opts.toolName,
        toolArgs: opts.toolArgs
          ? sanitizeToolArgs(opts.toolArgs, level)
          : undefined,
        clientName: opts.clientName,
        clientVersion: opts.clientVersion,
        aiModel: opts.aiModel,
        osInfo: getOsInfo(),
        errorType: errorObj.name || "Error",
        message: redactSensitiveString(errorObj.message),
        stackTrace:
          level !== "errors" && errorObj.stack
            ? redactSensitiveString(errorObj.stack)
            : undefined,
        context: opts.context,
        redacted: true,
      };

      // Write as JSONL (one JSON object per line)
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.logPath, line, "utf-8");

      // Print hint to stderr
      this.stderrLogger.error(
        `[MCP-ERROR] ${opts.toolName}: ${errorObj.message}. See ${this.logPath} for details.`,
      );
    } catch (writeError) {
      // Don't let logging failures break the server
      this.stderrLogger.error(
        `Failed to write error log: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
      );
    }
  }

  /**
   * Get the current log file path
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Get the log directory path
   */
  getLogDirectory(): string {
    return this.logDir;
  }
}

/**
 * Create an error logger instance
 */
export function createErrorLogger(
  config: ErrorLogConfig,
  stderrLogger: { info: (msg: string) => void; error: (msg: string) => void },
): ErrorLogger {
  return new ErrorLogger(config, stderrLogger);
}
