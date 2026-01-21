import fs from "node:fs";
import path from "node:path";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { resolveGeminiAuth } from "../auth/resolveAuth.js";
import { GeminiClient } from "../services/geminiClient.js";
import { expandHome } from "../utils/paths.js";
import {
  isRecord,
  toTrimmedString,
  toFiniteNumber,
} from "../utils/typeGuards.js";

export type CuratedModelFeature =
  | "thinking"
  | "vision"
  | "grounding"
  | "json_mode"
  | "system_instructions"
  | "function_calling";

export type CuratedModelFilter =
  | "all"
  | "thinking"
  | "vision"
  | "grounding"
  | "json_mode";

export type CuratedModel = {
  name: string;
  description: string;
  features: CuratedModelFeature[];
  contextWindow?: number;
  thinking?: string;
};

export const CURATED_GEMINI_MODELS: Record<string, CuratedModel> = {
  "gemini-2.5-pro": {
    name: "gemini-2.5-pro",
    description: "High-accuracy Gemini model optimized for complex reasoning.",
    features: [
      "thinking",
      "vision",
      "grounding",
      "json_mode",
      "system_instructions",
      "function_calling",
    ],
    thinking: "supported",
  },
  "gemini-2.5-flash": {
    name: "gemini-2.5-flash",
    description: "Fast, multimodal Gemini model for low-latency tasks.",
    features: [
      "thinking",
      "vision",
      "grounding",
      "json_mode",
      "system_instructions",
      "function_calling",
    ],
    thinking: "supported",
  },
  "gemini-2.5-flash-lite": {
    name: "gemini-2.5-flash-lite",
    description: "Lightweight Gemini model tuned for speed and cost.",
    features: [
      "vision",
      "grounding",
      "json_mode",
      "system_instructions",
      "function_calling",
    ],
  },
  "gemini-2.0-flash": {
    name: "gemini-2.0-flash",
    description: "Balanced Gemini model for everyday multimodal workloads.",
    features: [
      "vision",
      "grounding",
      "json_mode",
      "system_instructions",
      "function_calling",
    ],
  },
  "gemini-1.5-pro": {
    name: "gemini-1.5-pro",
    description: "Stable Gemini model with strong general-purpose performance.",
    features: [
      "vision",
      "grounding",
      "json_mode",
      "system_instructions",
      "function_calling",
    ],
  },
};

type CuratedModelsCache = {
  updatedAt: string;
  models: CuratedModel[];
};

type CuratedModelsSnapshot = {
  updatedAtMs: number;
  models: CuratedModel[];
};

const CACHE_PATH = "~/.gemini-mcp-bridge/curated-models.json";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 200;
const MAX_PAGES = 10;

let cachedSnapshot: CuratedModelsSnapshot | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<void> | null = null;

function normalizeModelName(raw: string): string {
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function readCacheFromDisk(): CuratedModelsSnapshot | null {
  const resolved = expandHome(CACHE_PATH);
  if (!fs.existsSync(resolved)) return null;
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as CuratedModelsCache;
    if (
      !parsed ||
      !Array.isArray(parsed.models) ||
      typeof parsed.updatedAt !== "string"
    )
      return null;
    const updatedAtMs = Date.parse(parsed.updatedAt);
    if (!Number.isFinite(updatedAtMs)) return null;
    const models = parsed.models.filter((model): model is CuratedModel => {
      return (
        model &&
        typeof model.name === "string" &&
        typeof model.description === "string" &&
        Array.isArray(model.features)
      );
    });
    if (models.length === 0) return null;
    return { updatedAtMs, models };
  } catch {
    return null;
  }
}

function writeCacheToDisk(models: CuratedModel[], updatedAtMs: number): void {
  const resolved = expandHome(CACHE_PATH);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const payload: CuratedModelsCache = {
    updatedAt: new Date(updatedAtMs).toISOString(),
    models,
  };
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2));
}

function getSnapshot(): CuratedModelsSnapshot | null {
  if (!cachedSnapshot) cachedSnapshot = readCacheFromDisk();
  return cachedSnapshot;
}

function isSnapshotFresh(snapshot: CuratedModelsSnapshot | null): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.updatedAtMs < REFRESH_INTERVAL_MS;
}

function listModelsFromSnapshot(
  filter: CuratedModelFilter,
  snapshot: CuratedModelsSnapshot | null,
): CuratedModel[] {
  const models = snapshot?.models?.length
    ? snapshot.models
    : Object.values(CURATED_GEMINI_MODELS);
  if (filter === "all") return models;
  return models.filter((model) => model.features.includes(filter));
}

type ApiModel = Record<string, unknown>;

function parseModelListResponse(response: unknown): {
  models: ApiModel[];
  nextPageToken?: string;
} {
  if (!isRecord(response)) return { models: [] };
  const models = Array.isArray(response.models)
    ? response.models.filter(isRecord)
    : [];
  const nextPageToken = toTrimmedString(response.nextPageToken);
  return { models: models as ApiModel[], nextPageToken };
}

function buildCuratedModelsFromApi(models: ApiModel[]): CuratedModel[] {
  const baseModels = Object.values(CURATED_GEMINI_MODELS);
  const baseByName = new Map(baseModels.map((model) => [model.name, model]));
  const out = new Map<string, CuratedModel>();

  for (const model of models) {
    const rawName = toTrimmedString(model.name);
    if (!rawName) continue;
    const name = normalizeModelName(rawName);
    const base = baseByName.get(name);
    const description =
      toTrimmedString(model.description) ??
      toTrimmedString(model.displayName) ??
      base?.description ??
      "Gemini model.";
    const features = base?.features ?? [];
    const contextWindow =
      toFiniteNumber(model.inputTokenLimit) ?? base?.contextWindow;
    const thinking = base?.thinking;

    const curated: CuratedModel = {
      name,
      description,
      features,
    };
    if (contextWindow) curated.contextWindow = contextWindow;
    if (thinking) curated.thinking = thinking;
    out.set(name, curated);
  }

  return Array.from(out.values());
}

async function fetchAllApiModels(client: GeminiClient): Promise<ApiModel[]> {
  const models: ApiModel[] = [];
  let pageToken: string | undefined;

  for (let i = 0; i < MAX_PAGES; i += 1) {
    const response = await client.listModels<unknown>({
      pageSize: MAX_PAGE_SIZE,
      pageToken,
    });
    const parsed = parseModelListResponse(response);
    models.push(...parsed.models);
    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }

  return models;
}

export async function refreshCuratedGeminiModels(deps: {
  config: BridgeConfig;
  logger: Logger;
}): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const authOpts = {
      mode: deps.config.auth.mode,
      apiKey: deps.config.auth.apiKey,
      apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
      apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
      apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
      apiKeyFilePaths: deps.config.auth.apiKeyFilePaths,
      oauthScopes: deps.config.auth.oauthScopes,
    } as const;
    const auth = await resolveGeminiAuth(authOpts);

    const resolvedTimeoutMs = deps.config.timeoutMs;

    let fallbackApiKey: string | undefined;
    if (
      auth.type === "oauth" &&
      deps.config.auth.mode === "auto" &&
      deps.config.auth.fallbackPolicy !== "never"
    ) {
      try {
        const apiKeyAuth = await resolveGeminiAuth({
          ...authOpts,
          mode: "apiKey",
        });
        if (apiKeyAuth.type === "apiKey") {
          fallbackApiKey = apiKeyAuth.apiKey;
        }
      } catch {
        // No API key available for fallback
      }
    }

    const clientConfig =
      auth.type === "oauth"
        ? {
            accessToken: auth.accessToken,
            apiKey: fallbackApiKey,
            allowApiKeyFallback:
              deps.config.auth.fallbackPolicy === "auto" &&
              Boolean(fallbackApiKey),
            apiKeyFallbackPolicy: deps.config.auth.fallbackPolicy,
            baseUrl: deps.config.apiBaseUrl,
            timeoutMs: resolvedTimeoutMs,
          }
        : {
            apiKey: auth.apiKey,
            baseUrl: deps.config.apiBaseUrl,
            timeoutMs: resolvedTimeoutMs,
          };
    const client = new GeminiClient(clientConfig, deps.logger);

    const apiModels = await fetchAllApiModels(client);
    if (apiModels.length === 0) {
      throw new Error("Gemini API returned no models.");
    }

    const curated = buildCuratedModelsFromApi(apiModels);
    if (curated.length === 0) {
      throw new Error(
        "Failed to build curated models from Gemini API response.",
      );
    }

    const updatedAtMs = Date.now();
    cachedSnapshot = { updatedAtMs, models: curated };
    writeCacheToDisk(curated, updatedAtMs);
    deps.logger.info("Refreshed curated Gemini model list", {
      count: curated.length,
    });
  })()
    .catch((error) => {
      deps.logger.warn("Failed to refresh curated Gemini model list", {
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export function startCuratedModelsAutoRefresh(deps: {
  config: BridgeConfig;
  logger: Logger;
}): void {
  if (refreshTimer) return;
  const snapshot = getSnapshot();
  if (!isSnapshotFresh(snapshot)) {
    void refreshCuratedGeminiModels(deps);
  }
  refreshTimer = setInterval(() => {
    void refreshCuratedGeminiModels(deps);
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

export function listCuratedGeminiModels(
  filter: CuratedModelFilter = "all",
): CuratedModel[] {
  return listModelsFromSnapshot(filter, getSnapshot());
}
