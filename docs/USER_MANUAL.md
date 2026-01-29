# User Manual

## Gemini MCP Bridge

Expose Gemini model capabilities to AI CLIs via MCP. This runs locally but requires an internet connection to reach the Gemini API.

---

## Quick Start

1. Install:
   - From npm: `npm install -g gemini-mcp-bridge`
   - From a local clone: `npm install` + `npm run build` + `npm install -g .` (or `npm install -g /path/to/geminiMCPbridge`)
   - No sudo? Install to a user prefix and point your MCP client at the full path:
     - `npm install -g gemini-mcp-bridge --prefix ~/.npm-global`
     - Use `command = "$HOME/.npm-global/bin/gemini-mcp-bridge"` in your client config.
2. Run guided setup: `gemini-mcp-bridge --setup`
3. Run: `gemini-mcp-bridge --stdio`
4. Add to your CLI config and restart

---

## Guided Setup

The setup wizard can guide backend selection, write
`~/.gemini-mcp-bridge/config.json`, optionally store an API key with consent,
and optionally run `gcloud` steps for Vertex:

```
gemini-mcp-bridge --setup

# Or from source:
npm run setup
```

Notes:
- The wizard can store API keys only with explicit consent. Input is masked and never printed.
- Vertex (gcloud/ADC) is the default sign-in path; API key fallback is optional.
- API keys are stored in `~/.gemini-mcp-bridge/api-key` by default (or `/etc/gemini-mcp-bridge/api-key` for shared use).
- It can optionally configure MCP clients (Codex, Claude Desktop, Claude Code, Gemini CLI) for the current user, all users (may require sudo), or specific users.
- When configuring MCP clients, it can optionally set a repo root for filesystem tools (auto-detects git root and asks for confirmation).
- Menu prompts are numbered so you can answer with `1`, `2`, etc.
- ANSI colors are used for prompts/tips when running in a TTY; set `NO_COLOR=1` to disable.
- Flags: `--backend`, `--project`, `--location`, `--quota-project`, `--auth-fallback`, `--config`, `--skip-gcloud`, `--non-interactive`.
- If you run from source without a global install, build first (`npm run build`) and launch with `node dist/index.js --stdio` (or `npm run dev` for watch mode).

---

## Authentication

Gemini MCP Bridge supports OAuth/ADC (subscription / `gcloud`) and API keys. Which one you should use depends on the API backend:

- **Vertex backend** (`GEMINI_MCP_BACKEND=vertex`): best match for subscription / `gcloud` login (OAuth with `cloud-platform` scope).
- **Developer backend** (`GEMINI_MCP_BACKEND=developer`, default): best match for API keys (`GEMINI_API_KEY` / `GOOGLE_API_KEY`).

### OAuth/ADC (subscription / gcloud)

- Login with ADC: `gcloud auth application-default login`
- Service account: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
- Optional access token override: `export GEMINI_MCP_OAUTH_TOKEN=...` (e.g., from `gcloud auth application-default print-access-token`)
  - Alternate env var: `export GOOGLE_OAUTH_ACCESS_TOKEN=...`
- Optional scopes override: `export GEMINI_MCP_OAUTH_SCOPES="scope1,scope2"`
  - For user ADC, scopes are set at login time. Re-run `gcloud auth application-default login --scopes=...` to change them.

Notes:

- If you logged in via **Gemini CLI**, that login does not automatically configure **gcloud ADC**. This bridge uses ADC (`~/.config/gcloud/application_default_credentials.json`) unless you provide `GEMINI_MCP_OAUTH_TOKEN`.
- If you see “insufficient authentication scopes” while using `gcloud` login, you are likely calling the **Developer API** with a `cloud-platform` token. Fix: set `GEMINI_MCP_BACKEND=vertex` (and configure project/location) or use an API key.
- `gcloud auth application-default login --scopes=...` may fail with `invalid_scope` for `https://www.googleapis.com/auth/generative-language` when using gcloud’s default OAuth client. In that case, use `GEMINI_API_KEY` (Developer backend) or use the Vertex backend instead of trying to force scopes.

### API keys

To force API key auth, set: `export GEMINI_MCP_AUTH_MODE=apiKey`

- `GEMINI_API_KEY` (preferred)
- `GOOGLE_API_KEY` (alternate)
- `GEMINI_API_KEY_FILE` (path to a key file)
- Default key file locations (no env var needed):
  - `~/.gemini-mcp-bridge/api-key`
  - `/etc/gemini-mcp-bridge/api-key` (shared; readable by local users)

### Auth mode

- `GEMINI_MCP_AUTH_MODE=oauth|apiKey|auto` (auto tries OAuth/ADC first, then API key)
  - Use `oauth` to require subscription login.
  - In `auto`, if an OAuth/ADC request fails (e.g. quota/credits), and an API key is configured, the bridge retries with the API key and returns a warning about the modality change.
- `GEMINI_MCP_AUTH_FALLBACK=auto|prompt|never` (default: prompt)
  - `prompt` returns a message when fallback is available but not approved.

If a key file is used, ensure it is locked down (e.g., `chmod 600 /path/to/key`).

## API Backend (Developer vs Vertex)

Gemini MCP Bridge can call either:

- **Gemini Developer API** (default): `https://generativelanguage.googleapis.com/v1beta`
  - Works with **API keys**.
  - OAuth user tokens often lack the required `generative-language` scope unless you logged in with that scope.
- **Vertex AI**: `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/{publisher}`
  - Works well with **OAuth/ADC (subscription / gcloud)** tokens (`cloud-platform` scope).
  - Requires a Google Cloud project + location.

Select backend:

- `export GEMINI_MCP_BACKEND=developer|vertex`

Vertex configuration (when `GEMINI_MCP_BACKEND=vertex`):

- `export GEMINI_MCP_VERTEX_PROJECT=...` (or `GOOGLE_CLOUD_PROJECT` or `CLOUDSDK_CORE_PROJECT`)
- `export GEMINI_MCP_VERTEX_LOCATION=...` (or `GOOGLE_CLOUD_LOCATION` or `CLOUDSDK_COMPUTE_REGION`, e.g. `us-central1`)
- Optional:
  - `export GEMINI_MCP_VERTEX_QUOTA_PROJECT=...` (or `GOOGLE_CLOUD_QUOTA_PROJECT`)
  - `export GEMINI_MCP_VERTEX_PUBLISHER=google`
  - `export GEMINI_MCP_VERTEX_API_BASE_URL=...` (override computed Vertex base URL)

You can also set this in `~/.gemini-mcp-bridge/config.json`:

```json
{
  "backend": "vertex",
  "vertex": {
    "project": "YOUR_PROJECT_ID",
    "location": "us-central1",
    "quotaProject": "YOUR_PROJECT_ID"
  }
}
```

### Embeddings on Vertex

When `GEMINI_MCP_BACKEND=vertex`, `gemini_embed_text` uses the Vertex AI `predict` API for embedding models (Vertex does not support `:embedContent` for these models).

### Quota project warning (Vertex / gcloud)

`gcloud` may print:

> Cannot find a quota project to add to ADC...

This can be ignored unless you hit quota/billing/“API not enabled” errors. To set it, run:

- `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`

If you’re using the Vertex backend, `YOUR_PROJECT_ID` is typically the same value as `GEMINI_MCP_VERTEX_PROJECT`.
You can also set `GEMINI_MCP_VERTEX_QUOTA_PROJECT` (or `vertex.quotaProject` in config); the bridge sends `x-goog-user-project` on Vertex requests.

## CLI Integration

MCP servers run as child processes of your CLI. Make sure any auth/backend env vars (or `~/.gemini-mcp-bridge/config.json`) are available in the environment where your CLI is launched.
The MCP server name (e.g., `gemini-bridge`) is arbitrary; pick any label and use it consistently in your client config.
For repo tools, configure a single root (or enable auto-roots/workspace roots in your client).

If you installed with a custom prefix (e.g., `~/.npm-global`), use the full path to the binary in `command`.

If you see multiple entries like `gemini` and `gemini-bridge`, they are usually just two config labels pointing at the same `gemini-mcp-bridge` command. To confirm what you’re running, check `which gemini-mcp-bridge` and `gemini-mcp-bridge --version`.

**OpenAI Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers."gemini-bridge"]
command = "gemini-mcp-bridge"
args = ["--stdio"]
# Optional: set an explicit root for repo tools.
# Omit this to rely on auto-roots/workspace roots if your Codex build supports them.
# roots = [{ uri = "file:///path/to/your-repo" }]
```

**Claude Code** (`~/.claude.json`):
```json
{
  "projects": {
    "/path/to/your-repo": {
      "mcpContextUris": ["file:///path/to/your-repo"],
      "mcpServers": {
        "gemini-bridge": {
          "type": "stdio",
          "command": "gemini-mcp-bridge",
          "args": ["--stdio"]
        }
      }
    }
  }
}
```

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "gemini-bridge": {
      "command": "gemini-mcp-bridge",
      "args": ["--stdio"],
      "roots": [{ "uri": "file:///path/to/your-repo" }]
    }
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "gemini-bridge": {
      "command": "gemini-mcp-bridge",
      "args": ["--stdio"]
    }
  }
}
```

### MCP roots (repo tools)

Repo-scoped filesystem tools (`gemini_code_review` / `gemini_code_fix`) require MCP roots from your client. The bridge does not assume the current working directory; the client decides what it is willing to share.

Recommended setup:
- Configure a single root pointing at your repo/workspace (roots/mcpContextUris).
- If your client supports auto-roots or workspace roots, enable it so the root follows the active project and omit explicit roots in the config.
- Keep roots narrow; auto-roots can over-share in multi-repo or home-directory contexts. Only enable for trusted servers.
- If multiple roots are configured, the bridge currently expects a single root. Use separate server entries per project.
- Some clients accept a shorthand string array (e.g., `["file:///path/to/repo"]`); the object form is MCP spec.

Example (client-specific field names vary):
```json
{ "roots": [{ "uri": "file:///path/to/your-repo" }] }
```

Changing roots:
- Update your MCP client config (same file as the server entry) and set a single repo/workspace root.
- If your client supports auto-roots/workspace roots, enable it and switch projects in the client UI to change roots (leave roots/mcpContextUris empty).
- From this repo, you can also run `node scripts/configure-mcp-users.mjs --user <name> --root-git`, `--root-cwd`, or `--root-path /path/to/repo`.
- Restart the client after editing config files.

---

## Common Tasks

- Text generation: `Use gemini_generate_text with prompt "..."`
- Streaming text generation: `Use gemini_generate_text_stream` (emits `notifications/progress` when your MCP client requests progress updates).
- Structured JSON output: `Use gemini_generate_json` (returns parsed JSON via MCP `structuredContent`).
- Image analysis: `Use gemini_analyze_image with prompt "..." and imageUrl "..."`
- Embeddings: `Use gemini_embed_text with text "..."`
- Batch embeddings: `Use gemini_embed_text_batch with texts ["...","..."]`
- Model list: `Use gemini_list_models` (optional filter: `all|thinking|vision|grounding|json_mode`)
  - If you don’t see a model you expect, increase `limit` or follow `nextPageToken` with `pageToken`.
  - Results are sorted newest → oldest (best-effort).
  - Curated metadata auto-refreshes daily when API credentials are available.
- Token count: `Use gemini_count_tokens`
- Batch token count: `Use gemini_count_tokens_batch with texts ["...","..."]`
- Safety metadata: `Use gemini_moderate_text` (best-effort safety/block metadata; does not replace policy enforcement).
- Repo code review: `Use gemini_code_review` (server reads files; requires `filesystem.mode=repo` + MCP roots; auto-roots/workspace roots recommended).
- Repo code fixes: `Use gemini_code_fix` (returns a unified diff for approval; optional auto-apply with `filesystem.allowWrite=true`; requires MCP roots in repo mode).
- Conversation threads: `gemini_conversation_create`, `gemini_conversation_list`, `gemini_conversation_export`, `gemini_conversation_reset`
  - Resources: `conversation://list`, `conversation://current`, `conversation://history/{id}`
- Model capabilities: read `gemini://model-capabilities` (and `gemini://model/{name}`) for curated per-model modality/context info.
- Provider-agnostic aliases: `llm_*` tools mirror the Gemini tools (useful for clients that want stable names across providers).

---

## Troubleshooting

- If `gemini_generate_text` or `gemini_analyze_image` returns “No text returned by model”, check the reported `blockReason` / `finishReason` and try a different prompt or model.
- If you hit `maxTokens exceeds configured limit`, lower `maxTokens` or raise the cap (`GEMINI_MCP_MAX_TOKENS` / `limits.maxTokensPerRequest`). Limits are discoverable via `gemini://capabilities` and are also encoded in the MCP tool schemas as `maximum` so clients can auto-respect them.
- If structured output fails with an error about `properties` being undefined, your `jsonSchema` is likely invalid/unsupported. Try omitting `jsonSchema`, simplifying it (type `object` + `properties` + `required`), and/or choosing a model with `json_mode` support (`gemini_list_models` filter=`json_mode`).
- If `gemini_analyze_image` fails to fetch an `imageUrl` (e.g. 403/404), download the image and pass `imageBase64` + `mimeType` instead.
- Set `GEMINI_MCP_DEBUG=1` to include raw API responses in some error outputs (secrets are redacted).
- If you hit the token budget prompt, run `gemini-mcp-bridge --approve-budget` to add another 200,000 tokens for today (default increment).
- If you see “Filesystem access is disabled”, set `GEMINI_MCP_FS_MODE=repo` (recommended) or `GEMINI_MCP_FS_MODE=system` + `GEMINI_MCP_FS_ALLOW_SYSTEM=1` (high risk).
- If you see “No MCP roots available” or “Multiple MCP roots”, configure your MCP client to send a single repo/workspace root (auto-roots/workspace roots may help).

---

## Configuration

### Configuring Root Folder (CI / Agents / Manual)

While standard MCP clients (like Claude Desktop) usually handle "roots" automatically, AI agents, CI environments, or some manual configurations might fail to send the project root, causing `No MCP roots available` errors when using filesystem tools.

To fix this, explicitly set the `GEMINI_MCP_FS_ROOT` environment variable in your client configuration to point to the project's absolute path.

**Gemini CLI (`~/.gemini/settings.json`):**
```json
{
  "mcpServers": {
    "gemini-bridge": {
      "command": "gemini-mcp-bridge",
      "args": ["--stdio"],
      "env": {
        "GEMINI_MCP_FS_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "gemini-bridge": {
      "command": "gemini-mcp-bridge",
      "args": ["--stdio"],
      "env": {
        "GEMINI_MCP_FS_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

### Config file

- Default path: `~/.gemini-mcp-bridge/config.json`
- Override with `--config /path/to/config.json`
- Use `--print-config` to view the resolved config (secrets redacted)

### CLI flags

- `--stdio` (default transport)
- `--http` (Streamable HTTP transport)
- `--http-host` / `--http-port`
- `--doctor` (optionally add `--check-api`)
- `--print-config`
- `--approve-budget` (adds another budget increment for today; optional `--increment <tokens>`)
- `--version` / `--help`

### Environment overrides

General:
- `GEMINI_MCP_AUTH_MODE` (oauth|apiKey|auto, default: auto)
- `GEMINI_MCP_AUTH_FALLBACK` (auto|prompt|never, default: prompt)
- `GEMINI_MCP_BACKEND` (developer|vertex, default: developer)
- `GEMINI_MCP_OAUTH_SCOPES` (comma-separated OAuth scopes)
- `GEMINI_MCP_API_KEY` (direct API key override)
- `GEMINI_MCP_API_KEY_FILE_PATHS` (comma-separated key file paths)
- `GEMINI_MCP_API_BASE_URL` (custom Gemini API base URL)
- `GEMINI_MCP_TIMEOUT_MS` (request timeout in ms, default: 120000)

Generation defaults:
- `GEMINI_MCP_MODEL` (default model)
- `GEMINI_MCP_TEMPERATURE`
- `GEMINI_MCP_TOP_K`
- `GEMINI_MCP_TOP_P`
- `GEMINI_MCP_MAX_OUTPUT_TOKENS`

Limits:
- `GEMINI_MCP_MAX_TOKENS` (hard cap for maxTokens per request, default: 65536)
- `GEMINI_MCP_MAX_INPUT_CHARS` (includes prompt + system instruction + conversation history)
- `GEMINI_MCP_MAX_REQUESTS_PER_MINUTE`
- `GEMINI_MCP_DAILY_TOKEN_LIMIT`
  - Bridge safety limit (UTC day), separate from model context windows.
- `GEMINI_MCP_BUDGET_INCREMENT` (tokens added per approval, default: 200000)
- `GEMINI_MCP_BUDGET_APPROVAL_POLICY` (auto|prompt|never, default: prompt)
- `GEMINI_MCP_BUDGET_APPROVAL_PATH` (approval file path, default: `~/.gemini-mcp-bridge/budget-approvals.json`)
- `GEMINI_MCP_SHARED_LIMITS`
- `GEMINI_MCP_REDIS_URL`
- `GEMINI_MCP_REDIS_PREFIX`
- `GEMINI_MCP_REDIS_CONNECT_TIMEOUT_MS` (ms)

Images:
- `GEMINI_MCP_MAX_IMAGE_BYTES`
- `GEMINI_MCP_ALLOWED_IMAGE_MIME_TYPES`

Vertex:
- `GEMINI_MCP_VERTEX_PROJECT` (or `GOOGLE_CLOUD_PROJECT` or `CLOUDSDK_CORE_PROJECT`)
- `GEMINI_MCP_VERTEX_LOCATION` (or `GOOGLE_CLOUD_LOCATION` or `CLOUDSDK_COMPUTE_REGION`)
- `GEMINI_MCP_VERTEX_QUOTA_PROJECT` (or `GOOGLE_CLOUD_QUOTA_PROJECT`)
- `GEMINI_MCP_VERTEX_PUBLISHER`
- `GEMINI_MCP_VERTEX_API_BASE_URL`

Conversation:
- `GEMINI_MCP_CONVERSATION_MAX_TURNS`
- `GEMINI_MCP_CONVERSATION_MAX_CHARS`

Filesystem (optional; high risk when enabled):
- `GEMINI_MCP_FS_MODE` (off|repo|system, default: off)
  - `repo` uses MCP roots (roots/list) as the allowlist (recommended for `gemini_code_review` / `gemini_code_fix`).
  - Repo mode requires client-provided roots; many clients can auto-share the current workspace. Configure a single root to avoid over-sharing.
  - `system` allows machine-wide paths (requires explicit opt-in via `GEMINI_MCP_FS_ALLOW_SYSTEM=1`).
- `GEMINI_MCP_FS_ALLOW_WRITE` (enable auto-apply for `gemini_code_fix`, default: false)
- `GEMINI_MCP_FS_ALLOW_SYSTEM` (required for filesystem.mode=system, default: false)
- `GEMINI_MCP_FS_FOLLOW_SYMLINKS` (default: false)
- `GEMINI_MCP_FS_MAX_FILES` (default: 25)
- `GEMINI_MCP_FS_MAX_FILE_BYTES` (default: 200000)
- `GEMINI_MCP_FS_MAX_TOTAL_BYTES` (default: 2000000)
- `GEMINI_MCP_FS_ALLOWED_EXTENSIONS` (comma-separated allowlist for directory traversal)
- `GEMINI_MCP_FS_DENY_PATTERNS` (comma-separated deny patterns; defaults block common secret/credential paths)

Transport/logging:
- `GEMINI_MCP_TRANSPORT` (stdio|http)
- `GEMINI_MCP_HTTP_HOST`
- `GEMINI_MCP_HTTP_PORT`
- `GEMINI_MCP_DEBUG`
- `GEMINI_MCP_ERROR_LOGGING` (off|errors|debug|full, default: off)
- `GEMINI_MCP_LOG_DIR` (log directory path)
- `GEMINI_MCP_LOG_MAX_SIZE` (max size per log file in MB, default: 10)
- `GEMINI_MCP_LOG_RETENTION` (days to keep logs, default: 14)

Cost tracking:
- `GEMINI_MCP_ENABLE_COST_ESTIMATES` (enable cost estimation in usage stats)

Advanced auth env mapping (for overriding which env vars to read credentials from):
- `GEMINI_MCP_API_KEY_ENV_VAR` (override default `GEMINI_API_KEY`)
- `GEMINI_MCP_API_KEY_ENV_VAR_ALT` (override default `GOOGLE_API_KEY`)
- `GEMINI_MCP_API_KEY_FILE_ENV_VAR` (override default `GEMINI_API_KEY_FILE`)

## Tools Reference

- `gemini_generate_text`: core text generation (supports JSON mode + strict JSON validation, grounding metadata, conversationId).
- `gemini_generate_text_stream`: streaming generation (progress notifications when requested by the client).
- `gemini_generate_json`: strict JSON output via `structuredContent` (clients should validate as needed).
- `gemini_analyze_image`: multimodal prompts (imageUrl or imageBase64 + mimeType).
- `gemini_embed_text`: embeddings (Developer: embedContent; Vertex: predict).
- `gemini_embed_text_batch`: batch embeddings (best-effort per item).
- `gemini_count_tokens`: token counting via API.
- `gemini_count_tokens_batch`: batch token counting (best-effort per item).
- `gemini_list_models`: list models via API (with curated filters/fallback).
- `gemini_moderate_text`: safety/block metadata (best-effort).
- `gemini_code_review`: review local repo code (server reads files; requires filesystem.mode=repo + MCP roots; auto-roots/workspace roots recommended).
- `gemini_code_fix`: propose fixes as a unified diff (optional auto-apply; requires filesystem.allowWrite=true). Repo mode requires MCP roots; auto-apply currently refuses new files and deletions.
- `gemini_conversation_create|list|export|reset`: in-memory conversation management for `conversationId` flows.
- `gemini_get_help`: built-in help text.
- `llm_*`: provider-agnostic aliases for the tools above.
- Curated metadata for `gemini_list_models` is cached under `~/.gemini-mcp-bridge/curated-models.json`.

## Prompts

- `code_review`: review a code snippet (args: `code`, optional `language`).
- `explain_with_thinking`: explain a topic (args: `topic`, optional `level`).
- `creative_writing`: generate creative writing (args: `prompt`, optional `style`/`length`).

## Resources

- `usage://stats`: usage and per-tool counts.
- `conversation://list`: known conversation threads (in this server session).
- `conversation://current`: last active conversation state.
- `conversation://history/{id}`: conversation history by id.
- `gemini://capabilities`: server capabilities and limits.
- `gemini://models`: configured defaults.
- `gemini://model-capabilities`: curated per-model capabilities.
- `gemini://model/{name}`: curated capabilities for a single model.
- `llm://model-capabilities`: provider-agnostic capabilities reference.
- `gemini://help/*`: usage, parameters, examples.

## Maintainers: Daily Gemini API radar (GitHub)

This repo includes a daily GitHub Actions workflow that watches the Gemini
Developer API model list and opens a GitHub issue when models/capabilities
change.

To enable it:

1. Add a repo secret `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in GitHub settings.
2. Ensure GitHub Actions are enabled (workflow: “Gemini API radar”).
3. (Optional) Run the workflow once manually (Actions → “Gemini API radar” → “Run workflow”) to create the baseline.
4. Download the `radar-report` artifact from the run summary and open `report.json`. If no changes were detected, the `diff` lists will be empty (`[]`) and `shouldOpenIssue` will be `false` (expected).
