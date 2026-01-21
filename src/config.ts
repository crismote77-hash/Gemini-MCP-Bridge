import fs from "node:fs";
import { z } from "zod";
import { expandHome } from "./utils/paths.js";
import { isRecord } from "./utils/typeGuards.js";

const transportModeSchema = z.enum(["stdio", "http"]);
const authModeSchema = z.enum(["apiKey", "oauth", "auto"]);
const authFallbackSchema = z.enum(["auto", "prompt", "never"]);
const backendSchema = z.enum(["developer", "vertex"]);
const filesystemModeSchema = z.enum(["off", "repo", "system"]);

const configSchema = z
  .object({
    backend: backendSchema.default("developer"),
    auth: z
      .object({
        mode: authModeSchema.default("auto"),
        fallbackPolicy: authFallbackSchema.default("prompt"),
        apiKey: z.string().optional(),
        apiKeyEnvVar: z.string().default("GEMINI_API_KEY"),
        apiKeyEnvVarAlt: z.string().default("GOOGLE_API_KEY"),
        apiKeyFileEnvVar: z.string().default("GEMINI_API_KEY_FILE"),
        apiKeyFilePaths: z
          .array(z.string())
          .default([
            "~/.gemini-mcp-bridge/api-key",
            "/etc/gemini-mcp-bridge/api-key",
          ]),
        oauthScopes: z
          .array(z.string())
          .default(["https://www.googleapis.com/auth/generative-language"]),
      })
      .default({}),
    apiBaseUrl: z
      .string()
      .default("https://generativelanguage.googleapis.com/v1beta"),
    vertex: z
      .object({
        project: z.string().optional(),
        location: z.string().optional(),
        quotaProject: z.string().optional(),
        publisher: z.string().default("google"),
        apiBaseUrl: z.string().optional(),
      })
      .default({}),
    model: z.string().default("gemini-2.5-flash"),
    timeoutMs: z.number().int().positive().default(30000),
    generation: z
      .object({
        temperature: z.number().min(0).max(2).default(0.7),
        topK: z.number().int().positive().default(40),
        topP: z.number().min(0).max(1).default(0.95),
        maxOutputTokens: z.number().int().positive().default(2048),
      })
      .default({}),
    limits: z
      .object({
        maxTokensPerRequest: z.number().int().positive().default(8192),
        maxInputChars: z.number().int().positive().default(10000),
        maxRequestsPerMinute: z.number().int().positive().default(30),
        maxTokensPerDay: z.number().int().positive().default(200000),
        budgetIncrementTokens: z.number().int().positive().default(200000),
        budgetApprovalPolicy: authFallbackSchema.default("prompt"),
        budgetApprovalPath: z
          .string()
          .default("~/.gemini-mcp-bridge/budget-approvals.json"),
        enableCostEstimates: z.boolean().default(false),
        shared: z
          .object({
            enabled: z.boolean().default(false),
            redisUrl: z.string().default("redis://localhost:6379"),
            keyPrefix: z.string().default("gemini-mcp-bridge"),
            connectTimeoutMs: z.number().int().positive().default(10000),
          })
          .default({}),
      })
      .default({}),
    images: z
      .object({
        maxBytes: z.number().int().positive().default(5_000_000),
        allowedMimeTypes: z
          .array(z.string())
          .default(["image/png", "image/jpeg", "image/webp"]),
      })
      .default({}),
    conversation: z
      .object({
        maxTurns: z.number().int().positive().default(20),
        maxTotalChars: z.number().int().positive().default(20000),
      })
      .default({}),
    filesystem: z
      .object({
        mode: filesystemModeSchema.default("off"),
        allowWrite: z.boolean().default(false),
        allowSystem: z.boolean().default(false),
        followSymlinks: z.boolean().default(false),
        maxFiles: z.number().int().positive().default(25),
        maxFileBytes: z.number().int().positive().default(200_000),
        maxTotalBytes: z.number().int().positive().default(2_000_000),
        allowedExtensions: z
          .array(z.string())
          .default([
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs",
            ".json",
            ".md",
            ".yaml",
            ".yml",
            ".toml",
            ".html",
            ".css",
            ".scss",
            ".py",
            ".go",
            ".rs",
            ".java",
            ".kt",
            ".cs",
            ".c",
            ".h",
            ".cpp",
            ".hpp",
            ".sh",
            ".bash",
            ".zsh",
            ".ps1",
            ".rb",
            ".php",
            ".swift",
            ".scala",
            ".sql",
          ]),
        denyPatterns: z
          .array(z.string())
          .default([
            "**/.git/**",
            "**/.hg/**",
            "**/.svn/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/.env",
            "**/.env.*",
            "**/.npmrc",
            "**/.pypirc",
            "**/.netrc",
            "**/.ssh/**",
            "**/application_default_credentials.json",
            "**/credentials.json",
            "**/client_secret*.json",
            "**/*service-account*.json",
            "**/*service_account*.json",
            "**/*.pem",
            "**/*.key",
            "**/*.p12",
            "**/*.pfx",
            "**/id_rsa",
            "**/id_ed25519",
          ]),
      })
      .default({}),
    logging: z
      .object({
        debug: z.boolean().default(false),
      })
      .default({}),
    transport: z
      .object({
        mode: transportModeSchema.default("stdio"),
        http: z
          .object({
            host: z.string().default("127.0.0.1"),
            port: z.number().int().positive().default(3922),
          })
          .default({}),
      })
      .default({}),
  })
  .strict();

export type BridgeConfig = z.infer<typeof configSchema>;

const DEFAULT_CONFIG_PATH = "~/.gemini-mcp-bridge/config.json";
function readJsonFileIfExists(filePath: string): unknown | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in config file ${filePath}: ${message}`);
  }
}

function mergeDeep(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = mergeDeep(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function parseBooleanEnv(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseIntEnv(value: string, name: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) throw new Error(`Invalid integer for ${name}`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer for ${name}`);
  return parsed;
}

function parseListEnv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadConfig(
  opts: { configPath?: string; env?: NodeJS.ProcessEnv } = {},
): BridgeConfig {
  const env = opts.env ?? process.env;

  const resolvedDefaultPath = expandHome(DEFAULT_CONFIG_PATH);
  const resolvedProvidedPath = opts.configPath
    ? expandHome(opts.configPath)
    : undefined;
  const configPathToUse =
    resolvedProvidedPath ??
    (fs.existsSync(resolvedDefaultPath) ? resolvedDefaultPath : undefined);

  const fileConfigRaw = configPathToUse
    ? readJsonFileIfExists(configPathToUse)
    : undefined;
  const fileConfigObj = isRecord(fileConfigRaw) ? fileConfigRaw : {};

  const merged: Record<string, unknown> = mergeDeep(
    configSchema.parse({}) as Record<string, unknown>,
    fileConfigObj,
  );

  if (env.GEMINI_MCP_API_KEY)
    merged.auth = {
      ...(merged.auth as object),
      apiKey: env.GEMINI_MCP_API_KEY,
    };
  if (env.GEMINI_MCP_AUTH_MODE)
    merged.auth = {
      ...(merged.auth as object),
      mode: env.GEMINI_MCP_AUTH_MODE,
    };
  if (env.GEMINI_MCP_AUTH_FALLBACK)
    merged.auth = {
      ...(merged.auth as object),
      fallbackPolicy: env.GEMINI_MCP_AUTH_FALLBACK,
    };
  if (env.GEMINI_MCP_API_KEY_ENV_VAR)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyEnvVar: env.GEMINI_MCP_API_KEY_ENV_VAR,
    };
  if (env.GEMINI_MCP_API_KEY_ENV_VAR_ALT)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyEnvVarAlt: env.GEMINI_MCP_API_KEY_ENV_VAR_ALT,
    };
  if (env.GEMINI_MCP_API_KEY_FILE_ENV_VAR)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyFileEnvVar: env.GEMINI_MCP_API_KEY_FILE_ENV_VAR,
    };
  if (env.GEMINI_MCP_API_KEY_FILE_PATHS)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyFilePaths: parseListEnv(env.GEMINI_MCP_API_KEY_FILE_PATHS),
    };
  if (env.GEMINI_MCP_OAUTH_SCOPES)
    merged.auth = {
      ...(merged.auth as object),
      oauthScopes: parseListEnv(env.GEMINI_MCP_OAUTH_SCOPES),
    };
  if (env.GEMINI_MCP_API_BASE_URL)
    merged.apiBaseUrl = env.GEMINI_MCP_API_BASE_URL;
  if (env.GEMINI_MCP_BACKEND)
    merged.backend = env.GEMINI_MCP_BACKEND as unknown;
  if (env.GEMINI_MCP_MODEL) merged.model = env.GEMINI_MCP_MODEL;
  if (env.GEMINI_MCP_TIMEOUT_MS)
    merged.timeoutMs = parseIntEnv(
      env.GEMINI_MCP_TIMEOUT_MS,
      "GEMINI_MCP_TIMEOUT_MS",
    );

  if (env.GEMINI_MCP_TEMPERATURE)
    merged.generation = {
      ...(merged.generation as object),
      temperature: Number.parseFloat(env.GEMINI_MCP_TEMPERATURE),
    };
  if (env.GEMINI_MCP_TOP_K)
    merged.generation = {
      ...(merged.generation as object),
      topK: parseIntEnv(env.GEMINI_MCP_TOP_K, "GEMINI_MCP_TOP_K"),
    };
  if (env.GEMINI_MCP_TOP_P)
    merged.generation = {
      ...(merged.generation as object),
      topP: Number.parseFloat(env.GEMINI_MCP_TOP_P),
    };
  if (env.GEMINI_MCP_MAX_OUTPUT_TOKENS)
    merged.generation = {
      ...(merged.generation as object),
      maxOutputTokens: parseIntEnv(
        env.GEMINI_MCP_MAX_OUTPUT_TOKENS,
        "GEMINI_MCP_MAX_OUTPUT_TOKENS",
      ),
    };

  if (env.GEMINI_MCP_MAX_TOKENS)
    merged.limits = {
      ...(merged.limits as object),
      maxTokensPerRequest: parseIntEnv(
        env.GEMINI_MCP_MAX_TOKENS,
        "GEMINI_MCP_MAX_TOKENS",
      ),
    };
  if (env.GEMINI_MCP_MAX_INPUT_CHARS)
    merged.limits = {
      ...(merged.limits as object),
      maxInputChars: parseIntEnv(
        env.GEMINI_MCP_MAX_INPUT_CHARS,
        "GEMINI_MCP_MAX_INPUT_CHARS",
      ),
    };
  if (env.GEMINI_MCP_MAX_REQUESTS_PER_MINUTE)
    merged.limits = {
      ...(merged.limits as object),
      maxRequestsPerMinute: parseIntEnv(
        env.GEMINI_MCP_MAX_REQUESTS_PER_MINUTE,
        "GEMINI_MCP_MAX_REQUESTS_PER_MINUTE",
      ),
    };
  if (env.GEMINI_MCP_DAILY_TOKEN_LIMIT)
    merged.limits = {
      ...(merged.limits as object),
      maxTokensPerDay: parseIntEnv(
        env.GEMINI_MCP_DAILY_TOKEN_LIMIT,
        "GEMINI_MCP_DAILY_TOKEN_LIMIT",
      ),
    };
  if (env.GEMINI_MCP_BUDGET_INCREMENT)
    merged.limits = {
      ...(merged.limits as object),
      budgetIncrementTokens: parseIntEnv(
        env.GEMINI_MCP_BUDGET_INCREMENT,
        "GEMINI_MCP_BUDGET_INCREMENT",
      ),
    };
  if (env.GEMINI_MCP_BUDGET_APPROVAL_POLICY)
    merged.limits = {
      ...(merged.limits as object),
      budgetApprovalPolicy: env.GEMINI_MCP_BUDGET_APPROVAL_POLICY,
    };
  if (env.GEMINI_MCP_BUDGET_APPROVAL_PATH)
    merged.limits = {
      ...(merged.limits as object),
      budgetApprovalPath: env.GEMINI_MCP_BUDGET_APPROVAL_PATH,
    };
  if (env.GEMINI_MCP_ENABLE_COST_ESTIMATES)
    merged.limits = {
      ...(merged.limits as object),
      enableCostEstimates: parseBooleanEnv(
        env.GEMINI_MCP_ENABLE_COST_ESTIMATES,
      ),
    };

  if (env.GEMINI_MCP_SHARED_LIMITS)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as Record<string, unknown>)?.shared as object),
        enabled: parseBooleanEnv(env.GEMINI_MCP_SHARED_LIMITS),
      },
    };
  if (env.GEMINI_MCP_REDIS_URL)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as Record<string, unknown>)?.shared as object),
        redisUrl: env.GEMINI_MCP_REDIS_URL,
      },
    };
  if (env.GEMINI_MCP_REDIS_PREFIX)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as Record<string, unknown>)?.shared as object),
        keyPrefix: env.GEMINI_MCP_REDIS_PREFIX,
      },
    };
  if (env.GEMINI_MCP_REDIS_CONNECT_TIMEOUT_MS)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as Record<string, unknown>)?.shared as object),
        connectTimeoutMs: parseIntEnv(
          env.GEMINI_MCP_REDIS_CONNECT_TIMEOUT_MS,
          "GEMINI_MCP_REDIS_CONNECT_TIMEOUT_MS",
        ),
      },
    };
  if (env.GEMINI_MCP_DEBUG)
    merged.logging = {
      ...(merged.logging as object),
      debug: parseBooleanEnv(env.GEMINI_MCP_DEBUG),
    };
  if (env.GEMINI_MCP_TRANSPORT)
    merged.transport = {
      ...(merged.transport as object),
      mode: env.GEMINI_MCP_TRANSPORT,
    };
  if (env.GEMINI_MCP_HTTP_HOST)
    merged.transport = {
      ...(merged.transport as object),
      http: {
        ...((merged.transport as Record<string, unknown>)?.http as object),
        host: env.GEMINI_MCP_HTTP_HOST,
      },
    };
  if (env.GEMINI_MCP_HTTP_PORT)
    merged.transport = {
      ...(merged.transport as object),
      http: {
        ...((merged.transport as Record<string, unknown>)?.http as object),
        port: parseIntEnv(env.GEMINI_MCP_HTTP_PORT, "GEMINI_MCP_HTTP_PORT"),
      },
    };

  const vertexProject =
    env.GEMINI_MCP_VERTEX_PROJECT ??
    env.GOOGLE_CLOUD_PROJECT ??
    env.CLOUDSDK_CORE_PROJECT;
  if (vertexProject)
    merged.vertex = {
      ...(merged.vertex as object),
      project: vertexProject,
    };

  const vertexLocation =
    env.GEMINI_MCP_VERTEX_LOCATION ??
    env.GOOGLE_CLOUD_LOCATION ??
    env.CLOUDSDK_COMPUTE_REGION;
  if (vertexLocation)
    merged.vertex = {
      ...(merged.vertex as object),
      location: vertexLocation,
    };

  if (env.GEMINI_MCP_VERTEX_PUBLISHER)
    merged.vertex = {
      ...(merged.vertex as object),
      publisher: env.GEMINI_MCP_VERTEX_PUBLISHER,
    };

  const vertexQuotaProject =
    env.GEMINI_MCP_VERTEX_QUOTA_PROJECT ?? env.GOOGLE_CLOUD_QUOTA_PROJECT;
  if (vertexQuotaProject)
    merged.vertex = {
      ...(merged.vertex as object),
      quotaProject: vertexQuotaProject,
    };

  if (env.GEMINI_MCP_VERTEX_API_BASE_URL)
    merged.vertex = {
      ...(merged.vertex as object),
      apiBaseUrl: env.GEMINI_MCP_VERTEX_API_BASE_URL,
    };

  if (
    merged.backend === "vertex" &&
    isRecord(merged.vertex) &&
    !("quotaProject" in merged.vertex) &&
    typeof merged.vertex.project === "string" &&
    merged.vertex.project.trim()
  ) {
    merged.vertex = {
      ...(merged.vertex as object),
      quotaProject: merged.vertex.project,
    };
  }

  if (env.GEMINI_MCP_MAX_IMAGE_BYTES)
    merged.images = {
      ...(merged.images as object),
      maxBytes: parseIntEnv(
        env.GEMINI_MCP_MAX_IMAGE_BYTES,
        "GEMINI_MCP_MAX_IMAGE_BYTES",
      ),
    };
  if (env.GEMINI_MCP_ALLOWED_IMAGE_MIME_TYPES)
    merged.images = {
      ...(merged.images as object),
      allowedMimeTypes: parseListEnv(env.GEMINI_MCP_ALLOWED_IMAGE_MIME_TYPES),
    };
  if (env.GEMINI_MCP_CONVERSATION_MAX_TURNS)
    merged.conversation = {
      ...(merged.conversation as object),
      maxTurns: parseIntEnv(
        env.GEMINI_MCP_CONVERSATION_MAX_TURNS,
        "GEMINI_MCP_CONVERSATION_MAX_TURNS",
      ),
    };
  if (env.GEMINI_MCP_CONVERSATION_MAX_CHARS)
    merged.conversation = {
      ...(merged.conversation as object),
      maxTotalChars: parseIntEnv(
        env.GEMINI_MCP_CONVERSATION_MAX_CHARS,
        "GEMINI_MCP_CONVERSATION_MAX_CHARS",
      ),
    };

  if (env.GEMINI_MCP_FS_MODE)
    merged.filesystem = {
      ...(merged.filesystem as object),
      mode: env.GEMINI_MCP_FS_MODE,
    };
  if (env.GEMINI_MCP_FS_ALLOW_WRITE)
    merged.filesystem = {
      ...(merged.filesystem as object),
      allowWrite: parseBooleanEnv(env.GEMINI_MCP_FS_ALLOW_WRITE),
    };
  if (env.GEMINI_MCP_FS_ALLOW_SYSTEM)
    merged.filesystem = {
      ...(merged.filesystem as object),
      allowSystem: parseBooleanEnv(env.GEMINI_MCP_FS_ALLOW_SYSTEM),
    };
  if (env.GEMINI_MCP_FS_FOLLOW_SYMLINKS)
    merged.filesystem = {
      ...(merged.filesystem as object),
      followSymlinks: parseBooleanEnv(env.GEMINI_MCP_FS_FOLLOW_SYMLINKS),
    };
  if (env.GEMINI_MCP_FS_MAX_FILES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxFiles: parseIntEnv(
        env.GEMINI_MCP_FS_MAX_FILES,
        "GEMINI_MCP_FS_MAX_FILES",
      ),
    };
  if (env.GEMINI_MCP_FS_MAX_FILE_BYTES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxFileBytes: parseIntEnv(
        env.GEMINI_MCP_FS_MAX_FILE_BYTES,
        "GEMINI_MCP_FS_MAX_FILE_BYTES",
      ),
    };
  if (env.GEMINI_MCP_FS_MAX_TOTAL_BYTES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxTotalBytes: parseIntEnv(
        env.GEMINI_MCP_FS_MAX_TOTAL_BYTES,
        "GEMINI_MCP_FS_MAX_TOTAL_BYTES",
      ),
    };
  if (env.GEMINI_MCP_FS_ALLOWED_EXTENSIONS)
    merged.filesystem = {
      ...(merged.filesystem as object),
      allowedExtensions: parseListEnv(env.GEMINI_MCP_FS_ALLOWED_EXTENSIONS),
    };
  if (env.GEMINI_MCP_FS_DENY_PATTERNS)
    merged.filesystem = {
      ...(merged.filesystem as object),
      denyPatterns: parseListEnv(env.GEMINI_MCP_FS_DENY_PATTERNS),
    };

  const parsed = configSchema.parse(merged);
  return parsed;
}
