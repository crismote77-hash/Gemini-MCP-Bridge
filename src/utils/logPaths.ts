import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Detect if running in WSL (Windows Subsystem for Linux)
 */
export function isWSL(): boolean {
  if (process.platform !== "linux") return false;

  // Check WSL_DISTRO_NAME env var (set by WSL)
  if (process.env.WSL_DISTRO_NAME) return true;

  // Check /proc/version for "microsoft" or "WSL"
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf-8").toLowerCase();
    return procVersion.includes("microsoft") || procVersion.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Get XDG_STATE_HOME or fallback for Linux
 */
function getXdgStateHome(): string {
  return (
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  );
}

/**
 * Get platform-specific log directory path
 *
 * - Linux/WSL: $XDG_STATE_HOME/gemini-mcp-bridge/logs/ (fallback ~/.local/state/...)
 * - macOS: ~/Library/Logs/gemini-mcp-bridge/
 * - Windows: %LOCALAPPDATA%\gemini-mcp-bridge\logs\
 */
export function getDefaultLogDirectory(): string {
  const appName = "gemini-mcp-bridge";

  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Logs", appName);

    case "win32": {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        return path.join(localAppData, appName, "logs");
      }
      // Fallback for Windows without LOCALAPPDATA
      return path.join(os.homedir(), "AppData", "Local", appName, "logs");
    }

    case "linux":
    default:
      // Works for both native Linux and WSL
      return path.join(getXdgStateHome(), appName, "logs");
  }
}

/**
 * Resolve the log directory - config override takes precedence
 */
export function resolveLogDirectory(configDirectory?: string): string {
  if (configDirectory) {
    // Expand ~ to home directory
    if (configDirectory.startsWith("~")) {
      return path.join(os.homedir(), configDirectory.slice(1));
    }
    return configDirectory;
  }
  return getDefaultLogDirectory();
}

/**
 * Ensure log directory exists with secure permissions
 */
export function ensureLogDirectory(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the current log file path
 */
export function getCurrentLogPath(logDir: string): string {
  return path.join(logDir, "mcp-errors.log");
}

/**
 * Get rotated log file path for a specific date
 */
export function getRotatedLogPath(logDir: string, date: Date): string {
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(logDir, `mcp-errors-${dateStr}.log`);
}
