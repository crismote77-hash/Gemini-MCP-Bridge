import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSign } from "node:crypto";
import { expandHome } from "../utils/paths.js";

export class AuthError extends Error {
  name = "AuthError";
}

type AuthMode = "apiKey" | "oauth" | "auto";
type ApiKeySource = "config" | "env" | "env_alt" | "file";
type OAuthSource = "env_token" | "adc_user" | "adc_service_account";

export type GeminiAuth =
  | { type: "apiKey"; apiKey: string; source: ApiKeySource }
  | { type: "oauth"; accessToken: string; source: OAuthSource };

type ResolveAuthOptions = {
  mode: AuthMode;
  apiKey?: string;
  apiKeyEnvVar: string;
  apiKeyEnvVarAlt: string;
  apiKeyFileEnvVar: string;
  oauthScopes: string[];
  env?: NodeJS.ProcessEnv;
};

type AuthorizedUserCreds = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_uri?: string;
};

type ServiceAccountCreds = {
  type: "service_account";
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

const DEFAULT_ADC_PATH = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

const oauthCache = new Map<string, { accessToken: string; expiresAt?: number; source: OAuthSource }>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AuthError(`Invalid JSON in credentials file ${filePath}: ${message}`);
  }
}

function resolveApiKeyAuth(opts: ResolveAuthOptions): GeminiAuth {
  const env = opts.env ?? process.env;
  if (opts.apiKey && opts.apiKey.trim()) {
    return { type: "apiKey", apiKey: opts.apiKey.trim(), source: "config" };
  }
  const envKey = env[opts.apiKeyEnvVar];
  if (envKey && envKey.trim()) {
    return { type: "apiKey", apiKey: envKey.trim(), source: "env" };
  }
  const altKey = env[opts.apiKeyEnvVarAlt];
  if (altKey && altKey.trim()) {
    return { type: "apiKey", apiKey: altKey.trim(), source: "env_alt" };
  }

  const filePath = env[opts.apiKeyFileEnvVar];
  if (filePath && filePath.trim()) {
    const resolved = expandHome(filePath.trim());
    if (!fs.existsSync(resolved)) {
      throw new AuthError(`API key file not found: ${resolved}`);
    }
    const raw = fs.readFileSync(resolved, "utf-8").trim();
    if (raw) {
      return { type: "apiKey", apiKey: raw, source: "file" };
    }
    throw new AuthError(`API key file is empty: ${resolved}`);
  }

  throw new AuthError(
    `Missing Gemini API key. Set ${opts.apiKeyEnvVar}, ${opts.apiKeyEnvVarAlt}, or ${opts.apiKeyFileEnvVar}.`,
  );
}

function resolveAdcPath(env: NodeJS.ProcessEnv): string {
  const envPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (envPath) return expandHome(envPath);
  return DEFAULT_ADC_PATH;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseExpiresIn(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

async function requestToken(url: string, body: URLSearchParams): Promise<{ accessToken: string; expiresIn?: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await response.text();
  let parsed: TokenResponse = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as TokenResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AuthError(`OAuth token response parse failed: ${message}`);
    }
  }
  if (!response.ok || !parsed.access_token) {
    const message = parsed.error_description || parsed.error || raw || `HTTP ${response.status}`;
    throw new AuthError(`OAuth token exchange failed: ${message}`);
  }
  return { accessToken: parsed.access_token, expiresIn: parseExpiresIn(parsed.expires_in) };
}

async function resolveAuthorizedUserToken(
  creds: AuthorizedUserCreds,
  tokenUrl: string,
): Promise<{ accessToken: string; expiresIn?: number }> {
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });
  return requestToken(tokenUrl, body);
}

function createJwtAssertion(creds: ServiceAccountCreds, scopes: string[], tokenUrl: string): string {
  if (scopes.length === 0) {
    throw new AuthError("OAuth scopes are required for service account credentials.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: creds.client_email,
    scope: scopes.join(" "),
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.private_key);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function resolveServiceAccountToken(
  creds: ServiceAccountCreds,
  scopes: string[],
  tokenUrl: string,
): Promise<{ accessToken: string; expiresIn?: number }> {
  const assertion = createJwtAssertion(creds, scopes, tokenUrl);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  return requestToken(tokenUrl, body);
}

async function resolveOAuthAuth(opts: ResolveAuthOptions): Promise<GeminiAuth> {
  const env = opts.env ?? process.env;
  const envToken = env.GEMINI_MCP_OAUTH_TOKEN ?? env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (envToken && envToken.trim()) {
    return { type: "oauth", accessToken: envToken.trim(), source: "env_token" };
  }

  const credentialsPath = resolveAdcPath(env);
  if (!fs.existsSync(credentialsPath)) {
    throw new AuthError(
      `OAuth credentials not found. Run "gcloud auth application-default login" or set GOOGLE_APPLICATION_CREDENTIALS.`,
    );
  }

  const raw = readJsonFile(credentialsPath);
  if (!isPlainObject(raw)) {
    throw new AuthError(`Invalid OAuth credentials file: ${credentialsPath}`);
  }

  const tokenUrl = typeof raw.token_uri === "string" ? raw.token_uri : DEFAULT_TOKEN_URL;
  const scopes = opts.oauthScopes ?? [];

  if (raw.type === "authorized_user") {
    const creds = raw as AuthorizedUserCreds;
    const cacheKey = `${credentialsPath}|user`;
    const cached = oauthCache.get(cacheKey);
    if (cached && cached.expiresAt && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return { type: "oauth", accessToken: cached.accessToken, source: cached.source };
    }

    if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
      throw new AuthError(`OAuth credentials missing required fields: ${credentialsPath}`);
    }
    const token = await resolveAuthorizedUserToken(creds, tokenUrl);
    const expiresAt = token.expiresIn ? Date.now() + token.expiresIn * 1000 : undefined;
    oauthCache.set(cacheKey, { accessToken: token.accessToken, expiresAt, source: "adc_user" });
    return { type: "oauth", accessToken: token.accessToken, source: "adc_user" };
  }

  if (raw.type === "service_account") {
    const creds = raw as ServiceAccountCreds;
    const cacheKey = `${credentialsPath}|service|${scopes.join(",")}`;
    const cached = oauthCache.get(cacheKey);
    if (cached && cached.expiresAt && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return { type: "oauth", accessToken: cached.accessToken, source: cached.source };
    }

    if (!creds.client_email || !creds.private_key) {
      throw new AuthError(`OAuth credentials missing required fields: ${credentialsPath}`);
    }
    const token = await resolveServiceAccountToken(creds, scopes, tokenUrl);
    const expiresAt = token.expiresIn ? Date.now() + token.expiresIn * 1000 : undefined;
    oauthCache.set(cacheKey, { accessToken: token.accessToken, expiresAt, source: "adc_service_account" });
    return { type: "oauth", accessToken: token.accessToken, source: "adc_service_account" };
  }

  throw new AuthError(
    `Unsupported OAuth credential type "${String(raw.type ?? "unknown")}" in ${credentialsPath}.`,
  );
}

export async function resolveGeminiAuth(opts: ResolveAuthOptions): Promise<GeminiAuth> {
  const errors: string[] = [];

  if (opts.mode !== "apiKey") {
    try {
      return await resolveOAuthAuth(opts);
    } catch (error) {
      if (opts.mode === "oauth") throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    return resolveApiKeyAuth(opts);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const details = errors.length > 0 ? ` Details: ${errors.join(" | ")}` : "";
  throw new AuthError(
    `Missing Gemini credentials. Configure OAuth (gcloud auth application-default login) or set API keys.${details}`,
  );
}
