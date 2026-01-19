# User Manual

## Gemini MCP Bridge

Expose Gemini model capabilities to AI CLIs via MCP. This runs locally but requires an internet connection to reach the Gemini API.

---

## Quick Start

1. Install: `npm install -g gemini-mcp-bridge`
2. Authenticate (default: OAuth/ADC):
   - `gcloud auth application-default login`
   - or set API key: `export GEMINI_API_KEY=...` (or `GOOGLE_API_KEY`)
3. Run: `gemini-mcp-bridge --stdio`
4. Add to your CLI config and restart

---

## Authentication

Gemini MCP Bridge supports OAuth (subscription login) and API keys.

### OAuth (default)

- Login with ADC: `gcloud auth application-default login`
- Service account: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
- Optional access token override: `export GEMINI_MCP_OAUTH_TOKEN=...` (e.g., from `gcloud auth application-default print-access-token`)
  - Alternate env var: `export GOOGLE_OAUTH_ACCESS_TOKEN=...`
- Optional scopes override: `export GEMINI_MCP_OAUTH_SCOPES="scope1,scope2"`
  - For user ADC, scopes are set at login time. Re-run `gcloud auth application-default login --scopes=...` to change them.

### API keys

To force API key auth, set: `export GEMINI_MCP_AUTH_MODE=apiKey`

- `GEMINI_API_KEY` (preferred)
- `GOOGLE_API_KEY` (alternate)
- `GEMINI_API_KEY_FILE` (path to a key file)

### Auth mode

- `GEMINI_MCP_AUTH_MODE=oauth|apiKey|auto` (auto tries OAuth first, then API key)
  - Use `oauth` to require subscription login.

If a key file is used, ensure it is locked down (e.g., `chmod 600 /path/to/key`).

## CLI Integration

**OpenAI Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.gemini]
command = "gemini-mcp-bridge"
args = ["--stdio"]
```

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "gemini": {
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
- Token count: `Use gemini_count_tokens`

---

## Configuration (Env Overrides)

- `GEMINI_MCP_AUTH_MODE` (oauth|apiKey|auto, default: auto)
- `GEMINI_MCP_OAUTH_SCOPES` (comma-separated OAuth scopes)
- `GEMINI_MCP_MODEL` (default model)
- `GEMINI_MCP_TIMEOUT_MS` (request timeout in ms, default: 30000)
- `GEMINI_MCP_MAX_TOKENS` (max output tokens per request)
- `GEMINI_MCP_MAX_INPUT_CHARS` (max input size)
- `GEMINI_MCP_MAX_REQUESTS_PER_MINUTE` (rate limit)
- `GEMINI_MCP_DAILY_TOKEN_LIMIT` (daily budget)
- `GEMINI_MCP_MAX_IMAGE_BYTES` (image size cap)
- `GEMINI_MCP_ALLOWED_IMAGE_MIME_TYPES` (comma-separated)

## Tools Reference

- `gemini_generate_text`: prompt + generation settings, JSON mode, grounding, safety settings, conversationId.
- `gemini_analyze_image`: prompt + imageUrl/imageBase64 + mimeType.
- `gemini_embed_text`: text embeddings.
- `gemini_count_tokens`: token counting via API.
- `gemini_list_models`: list available models (optional filter: `all|thinking|vision|grounding|json_mode` for curated metadata).
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
