# User Manual

## Gemini MCP Bridge

Expose Gemini model capabilities to AI CLIs via MCP. This runs locally but requires an internet connection to reach the Gemini API.

---

## Quick Start

1. Install: `npm install -g gemini-mcp-bridge`
2. Authenticate:
   - Subscription/OAuth (Vertex): `gcloud auth application-default login` + set `GEMINI_MCP_BACKEND=vertex` + `GEMINI_MCP_VERTEX_PROJECT=...` + `GEMINI_MCP_VERTEX_LOCATION=...`
   - API key (Gemini Developer API): `export GEMINI_API_KEY=...` (or `GOOGLE_API_KEY`)
3. Run: `gemini-mcp-bridge --stdio`
4. Add to your CLI config and restart

---

## Guided Setup (repo)

If you are running from source, the setup wizard can guide backend selection,
write `~/.gemini-mcp-bridge/config.json`, and optionally run `gcloud` steps for
Vertex:

```
npm run setup
```

Notes:
- The wizard does not store API keys. Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in your shell.
- It can optionally configure MCP clients for the current user, all users (may require sudo), or specific users.
- Menu prompts are numbered so you can answer with `1`, `2`, etc.
- ANSI colors are used for prompts/tips when running in a TTY; set `NO_COLOR=1` to disable.
- Flags: `--backend`, `--project`, `--location`, `--config`, `--skip-gcloud`, `--non-interactive`.

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

### Auth mode

- `GEMINI_MCP_AUTH_MODE=oauth|apiKey|auto` (auto tries OAuth/ADC first, then API key)
  - Use `oauth` to require subscription login.
  - In `auto`, if an OAuth/ADC request fails (e.g. quota/credits), and an API key is configured, the bridge retries with the API key and returns a warning about the modality change.

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
  - `export GEMINI_MCP_VERTEX_PUBLISHER=google`
  - `export GEMINI_MCP_VERTEX_API_BASE_URL=...` (override computed Vertex base URL)

You can also set this in `~/.gemini-mcp-bridge/config.json`:

```json
{
  "backend": "vertex",
  "vertex": { "project": "YOUR_PROJECT_ID", "location": "us-central1" }
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

## CLI Integration

MCP servers run as child processes of your CLI. Make sure any auth/backend env vars (or `~/.gemini-mcp-bridge/config.json`) are available in the environment where your CLI is launched.

**OpenAI Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers."gemini-bridge"]
command = "gemini-mcp-bridge"
args = ["--stdio"]
```

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
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

---

## Common Tasks

- Text generation: `Use gemini_generate_text with prompt "..."`
- Image analysis: `Use gemini_analyze_image with prompt "..." and imageUrl "..."`
- Embeddings: `Use gemini_embed_text with text "..."`
- Model list: `Use gemini_list_models` (optional filter: `all|thinking|vision|grounding|json_mode`)
  - If you don’t see a model you expect, increase `limit` or follow `nextPageToken` with `pageToken`.
  - Results are sorted newest → oldest (best-effort).
  - Curated metadata auto-refreshes daily when API credentials are available.
- Token count: `Use gemini_count_tokens`

---

## Configuration

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
- `--version` / `--help`

### Environment overrides

General:
- `GEMINI_MCP_AUTH_MODE` (oauth|apiKey|auto, default: auto)
- `GEMINI_MCP_BACKEND` (developer|vertex, default: developer)
- `GEMINI_MCP_OAUTH_SCOPES` (comma-separated OAuth scopes)
- `GEMINI_MCP_API_KEY` (direct API key override)
- `GEMINI_MCP_API_BASE_URL` (custom Gemini API base URL)
- `GEMINI_MCP_TIMEOUT_MS` (request timeout in ms, default: 30000)

Generation defaults:
- `GEMINI_MCP_MODEL` (default model)
- `GEMINI_MCP_TEMPERATURE`
- `GEMINI_MCP_TOP_K`
- `GEMINI_MCP_TOP_P`
- `GEMINI_MCP_MAX_OUTPUT_TOKENS`

Limits:
- `GEMINI_MCP_MAX_TOKENS` (hard cap for maxTokens per request)
- `GEMINI_MCP_MAX_INPUT_CHARS` (includes prompt + system instruction + conversation history)
- `GEMINI_MCP_MAX_REQUESTS_PER_MINUTE`
- `GEMINI_MCP_DAILY_TOKEN_LIMIT`
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
- `GEMINI_MCP_VERTEX_PUBLISHER`
- `GEMINI_MCP_VERTEX_API_BASE_URL`

Conversation:
- `GEMINI_MCP_CONVERSATION_MAX_TURNS`
- `GEMINI_MCP_CONVERSATION_MAX_CHARS`

Transport/logging:
- `GEMINI_MCP_TRANSPORT` (stdio|http)
- `GEMINI_MCP_HTTP_HOST`
- `GEMINI_MCP_HTTP_PORT`
- `GEMINI_MCP_DEBUG`

Cost tracking:
- `GEMINI_MCP_ENABLE_COST_ESTIMATES` (enable cost estimation in usage stats)

Advanced auth env mapping (for overriding which env vars to read credentials from):
- `GEMINI_MCP_API_KEY_ENV_VAR` (override default `GEMINI_API_KEY`)
- `GEMINI_MCP_API_KEY_ENV_VAR_ALT` (override default `GOOGLE_API_KEY`)
- `GEMINI_MCP_API_KEY_FILE_ENV_VAR` (override default `GEMINI_API_KEY_FILE`)

## Tools Reference

- `gemini_generate_text`: prompt + generation settings, JSON mode, grounding, safety settings, conversationId.
- `gemini_analyze_image`: prompt + imageUrl/imageBase64 + mimeType + optional maxTokens.
- `gemini_embed_text`: text embeddings (Vertex backend uses the Vertex `predict` API for embedding models).
- `gemini_count_tokens`: token counting via API.
- `gemini_list_models`: list available models (optional filter: `all|thinking|vision|grounding|json_mode` for curated metadata).
  - Curated metadata is cached under `~/.gemini-mcp-bridge/curated-models.json`.
- `gemini_get_help`: built-in help topics.

## Prompts

- `code_review`: review a code snippet (args: `code`, optional `language`).
- `explain_with_thinking`: explain a topic (args: `topic`, optional `level`).
- `creative_writing`: generate creative writing (args: `prompt`, optional `style`/`length`).

## Resources

- `usage://stats`: usage and per-tool counts.
- `conversation://current`: last active conversation state.
- `gemini://capabilities`: server capabilities and limits.
- `gemini://models`: configured defaults.
- `gemini://help/*`: usage, parameters, examples.
