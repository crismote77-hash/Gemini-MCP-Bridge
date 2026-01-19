#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createStderrLogger } from "./logger.js";
import { RateLimiter } from "./limits/rateLimiter.js";
import { DailyTokenBudget } from "./limits/dailyTokenBudget.js";
import { resolveGeminiAuth } from "./auth/resolveAuth.js";
import { GeminiClient } from "./services/geminiClient.js";
import { ConversationStore } from "./services/conversationStore.js";
import { createMcpServer } from "./server.js";
import { startHttpServer } from "./httpServer.js";
import { createSharedLimitStore } from "./limits/sharedStore.js";
import { redactMeta, redactString } from "./utils/redact.js";
import { resolvePrimaryApiBaseUrl } from "./utils/apiBaseUrls.js";

type CliCommand =
  | {
      kind: "serve";
      configPath?: string;
      transportOverride?: "stdio" | "http";
      httpHost?: string;
      httpPort?: number;
    }
  | { kind: "print-config"; configPath?: string }
  | { kind: "doctor"; configPath?: string; checkApi: boolean }
  | { kind: "help" }
  | { kind: "version" };

const PROJECT_NAME = "gemini-bridge";
const VERSION_FALLBACK = "0.1.0";

function readPackageInfo(): { name: string; version: string } {
  try {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(distDir, "..", "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return { name: PROJECT_NAME, version: VERSION_FALLBACK };
    }
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return { name: PROJECT_NAME, version: parsed.version ?? VERSION_FALLBACK };
  } catch {
    return { name: PROJECT_NAME, version: VERSION_FALLBACK };
  }
}

function parseArgs(argv: string[]): CliCommand {
  const args = [...argv];
  let configPath: string | undefined;
  let checkApi = false;
  let kind: CliCommand["kind"] = "serve";
  let transportOverride: "stdio" | "http" | undefined;
  let httpHost: string | undefined;
  let httpPort: number | undefined;

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--config") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      configPath = value;
      continue;
    }
    if (a === "--check-api") {
      checkApi = true;
      continue;
    }
    if (a === "--print-config") {
      kind = "print-config";
      continue;
    }
    if (a === "--http") {
      if (transportOverride && transportOverride !== "http")
        return { kind: "help" };
      transportOverride = "http";
      continue;
    }
    if (a === "--http-host") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      httpHost = value;
      continue;
    }
    if (a === "--http-port") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535)
        return { kind: "help" };
      httpPort = parsed;
      continue;
    }
    if (a === "--doctor") {
      kind = "doctor";
      continue;
    }
    if (a === "--help" || a === "-h") {
      kind = "help";
      continue;
    }
    if (a === "--version" || a === "-v") {
      kind = "version";
      continue;
    }
    if (a === "--stdio") {
      if (transportOverride && transportOverride !== "stdio")
        return { kind: "help" };
      transportOverride = "stdio";
      continue;
    }

    process.stderr.write(`Unknown argument: ${a}\n`);
    process.exit(1);
  }

  if (kind === "doctor") return { kind, configPath, checkApi };
  if (kind === "print-config") return { kind, configPath };
  if (kind === "help") return { kind };
  if (kind === "version") return { kind };
  return { kind: "serve", configPath, transportOverride, httpHost, httpPort };
}

function printHelp(info: { name: string; version: string }): void {
  process.stdout.write(`${info.name} ${info.version}\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  gemini-mcp-bridge --stdio [--config path]\n`);
  process.stdout.write(
    `  gemini-mcp-bridge --http [--http-host host] [--http-port port] [--config path]\n`,
  );
  process.stdout.write(`  gemini-mcp-bridge --print-config [--config path]\n`);
  process.stdout.write(
    `  gemini-mcp-bridge --doctor [--config path] [--check-api]\n`,
  );
  process.stdout.write(`  gemini-mcp-bridge --version\n`);
  process.stdout.write(`  gemini-mcp-bridge --help\n`);
  process.stdout.write(`\n`);
}

async function runDoctor(
  configPath?: string,
  checkApi = false,
): Promise<number> {
  const config = loadConfig({ configPath });
  const logger = createStderrLogger({ debugEnabled: config.logging.debug });

  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const nextSteps: string[] = [];
  const timestamp = new Date().toISOString();

  checks.push({
    name: "config_loaded",
    ok: true,
    message: configPath ? `loaded ${configPath}` : "loaded default config",
  });

  checks.push({
    name: "backend",
    ok: true,
    message: config.backend,
  });

  let primaryApiBaseUrl: string | null = null;
  let primaryApiBaseUrlError: string | null = null;
  try {
    primaryApiBaseUrl = resolvePrimaryApiBaseUrl(config);
  } catch (error) {
    primaryApiBaseUrlError =
      error instanceof Error ? error.message : String(error);
  }

  checks.push({
    name: "primary_api_base_url",
    ok: !primaryApiBaseUrlError,
    message: primaryApiBaseUrlError ?? primaryApiBaseUrl ?? "unknown",
  });

  if (config.backend === "vertex") {
    checks.push({
      name: "vertex_project",
      ok: Boolean(config.vertex.project),
      message: config.vertex.project ? "set" : "missing",
    });
    checks.push({
      name: "vertex_location",
      ok: Boolean(config.vertex.location),
      message: config.vertex.location ? "set" : "missing",
    });
    checks.push({
      name: "vertex_publisher",
      ok: true,
      message: config.vertex.publisher,
    });
    checks.push({
      name: "vertex_api_base_url_override",
      ok: true,
      message: config.vertex.apiBaseUrl ? "set" : "not set",
    });
    if (primaryApiBaseUrlError) {
      nextSteps.push(
        "Set GEMINI_MCP_VERTEX_PROJECT (or GOOGLE_CLOUD_PROJECT) and GEMINI_MCP_VERTEX_LOCATION (or GOOGLE_CLOUD_LOCATION or CLOUDSDK_COMPUTE_REGION), or set GEMINI_MCP_VERTEX_API_BASE_URL.",
      );
    }
  }

  checks.push({
    name: "auth_mode",
    ok: true,
    message: config.auth.mode,
  });
  checks.push({
    name: "oauth_scopes",
    ok: true,
    message:
      config.auth.oauthScopes.length > 0
        ? config.auth.oauthScopes.join(", ")
        : "none",
  });

  const apiKeyEnv = process.env[config.auth.apiKeyEnvVar];
  const apiKeyAlt = process.env[config.auth.apiKeyEnvVarAlt];
  const apiKeyFileEnv = process.env[config.auth.apiKeyFileEnvVar];
  const oauthTokenEnv = process.env.GEMINI_MCP_OAUTH_TOKEN;
  const oauthTokenAltEnv = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const googleCredsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  checks.push({
    name: "api_key_env",
    ok: true,
    message: apiKeyEnv
      ? `set (${config.auth.apiKeyEnvVar})`
      : `missing (${config.auth.apiKeyEnvVar})`,
  });
  checks.push({
    name: "api_key_env_alt",
    ok: true,
    message: apiKeyAlt
      ? `set (${config.auth.apiKeyEnvVarAlt})`
      : `missing (${config.auth.apiKeyEnvVarAlt})`,
  });
  checks.push({
    name: "api_key_file_env",
    ok: true,
    message: apiKeyFileEnv
      ? `set (${config.auth.apiKeyFileEnvVar})`
      : `missing (${config.auth.apiKeyFileEnvVar})`,
  });
  checks.push({
    name: "oauth_token_env",
    ok: true,
    message: oauthTokenEnv
      ? "set (GEMINI_MCP_OAUTH_TOKEN)"
      : "missing (GEMINI_MCP_OAUTH_TOKEN)",
  });
  checks.push({
    name: "google_oauth_access_token",
    ok: true,
    message: oauthTokenAltEnv
      ? "set (GOOGLE_OAUTH_ACCESS_TOKEN)"
      : "missing (GOOGLE_OAUTH_ACCESS_TOKEN)",
  });
  checks.push({
    name: "google_application_credentials",
    ok: true,
    message: googleCredsEnv
      ? "set (GOOGLE_APPLICATION_CREDENTIALS)"
      : "missing (GOOGLE_APPLICATION_CREDENTIALS)",
  });

  try {
    const resolved = await resolveGeminiAuth({
      mode: config.auth.mode,
      apiKey: config.auth.apiKey,
      apiKeyEnvVar: config.auth.apiKeyEnvVar,
      apiKeyEnvVarAlt: config.auth.apiKeyEnvVarAlt,
      apiKeyFileEnvVar: config.auth.apiKeyFileEnvVar,
      oauthScopes: config.auth.oauthScopes,
    });
    checks.push({
      name: "auth_resolution",
      ok: true,
      message: `resolved (${resolved.type}:${resolved.source})`,
    });

    if (checkApi) {
      if (resolved.type === "oauth" && primaryApiBaseUrlError) {
        checks.push({
          name: "gemini_api",
          ok: false,
          message: `skipped (${primaryApiBaseUrlError})`,
        });
      } else {
        const clientConfig =
          resolved.type === "oauth"
            ? {
                accessToken: resolved.accessToken,
                baseUrl: primaryApiBaseUrl ?? config.apiBaseUrl,
                timeoutMs: 15000,
              }
            : {
                apiKey: resolved.apiKey,
                baseUrl: config.apiBaseUrl,
                timeoutMs: 15000,
              };
        const client = new GeminiClient(clientConfig, logger);
        await client.listModels({ pageSize: 1 });
        checks.push({ name: "gemini_api", ok: true, message: "reachable" });
      }
    }
  } catch (error) {
    checks.push({
      name: "auth_resolution",
      ok: false,
      message: redactString(
        error instanceof Error ? error.message : String(error),
      ),
    });
    nextSteps.push(
      `Authenticate via OAuth (gcloud auth application-default login) or set ${config.auth.apiKeyEnvVar} (or ${config.auth.apiKeyEnvVarAlt}) or ${config.auth.apiKeyFileEnvVar}.`,
    );
  }

  const ok = checks.every((c) => c.ok);
  process.stdout.write(
    JSON.stringify({ ok, timestamp, checks, nextSteps }, null, 2) + "\n",
  );
  return ok ? 0 : 1;
}

async function main(): Promise<void> {
  const cmd = parseArgs(process.argv.slice(2));
  const pkg = readPackageInfo();

  if (cmd.kind === "help") {
    printHelp(pkg);
    process.exit(0);
  }
  if (cmd.kind === "version") {
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    process.exit(0);
  }
  if (cmd.kind === "doctor") {
    const code = await runDoctor(cmd.configPath, cmd.checkApi);
    process.exit(code);
  }
  if (cmd.kind === "print-config") {
    const config = loadConfig({ configPath: cmd.configPath });
    const safe = redactMeta(config as unknown as Record<string, unknown>) ?? {};
    process.stdout.write(JSON.stringify(safe, null, 2) + "\n");
    process.exit(0);
  }

  const config = loadConfig({ configPath: cmd.configPath });
  const transportMode = cmd.transportOverride ?? config.transport.mode;
  const httpHost = cmd.httpHost ?? config.transport.http.host;
  const httpPort = cmd.httpPort ?? config.transport.http.port;
  const logger = createStderrLogger({ debugEnabled: config.logging.debug });

  const sharedLimitStore = await createSharedLimitStore({
    enabled: config.limits.shared.enabled,
    redisUrl: config.limits.shared.redisUrl,
    keyPrefix: config.limits.shared.keyPrefix,
    connectTimeoutMs: config.limits.shared.connectTimeoutMs,
    logger,
  });
  const rateLimiter = new RateLimiter({
    maxPerMinute: config.limits.maxRequestsPerMinute,
    sharedStore: sharedLimitStore ?? undefined,
  });
  const dailyBudget = new DailyTokenBudget({
    maxTokensPerDay: config.limits.maxTokensPerDay,
    sharedStore: sharedLimitStore ?? undefined,
  });
  const sharedDeps = { config, logger, rateLimiter, dailyBudget };

  let closeServer: (() => Promise<void>) | null = null;

  if (transportMode === "http") {
    const httpHandle = await startHttpServer(sharedDeps, pkg, {
      host: httpHost,
      port: httpPort,
    });
    closeServer = httpHandle.close;
  } else {
    const conversationStore = new ConversationStore({
      maxTurns: config.conversation.maxTurns,
      maxTotalChars: config.conversation.maxTotalChars,
    });
    const server = createMcpServer({ ...sharedDeps, conversationStore }, pkg);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Server running on stdio", {
      name: pkg.name,
      version: pkg.version,
    });
    process.stdin.resume();
    closeServer = async () => {
      await server.close();
    };
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    try {
      if (closeServer) await closeServer();
      if (sharedLimitStore) await sharedLimitStore.close();
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  const message = redactString(
    err instanceof Error ? err.message : String(err),
  );
  process.stderr.write(`[fatal] ${message}\n`);
  process.exit(1);
});
