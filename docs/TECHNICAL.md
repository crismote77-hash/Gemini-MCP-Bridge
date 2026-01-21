# Technical Documentation

## Overview

Gemini MCP Bridge is a local MCP server that exposes Gemini API capabilities to AI CLIs. It mirrors the local Gemini MCP surface while keeping opinionated guardrails (rate limits, daily budgets, and discoverability resources).

## Directory Structure

```
src/
  index.ts           # CLI entrypoint, transport selection
  server.ts          # MCP server wiring
  httpServer.ts      # Streamable HTTP transport
  config.ts          # Config loader with env overrides
  logger.ts          # Stderr logger with redaction
  auth/              # OAuth + API key resolution
  models/            # Curated model metadata
  prompts/           # MCP prompts
  services/          # Gemini API client + conversation store
  tools/             # MCP tools (generate/stream/json, analyze, embed (+batch), count (+batch), list, moderate, code_review/code_fix, conversation, aliases, help)
  resources/         # MCP resources (usage, conversation (+history), discovery, model capabilities)
  limits/            # Rate limiting + daily budgets (local + Redis)
  utils/
    toolHelpers.ts   # Shared tool utilities (validation, client, error handling)
    geminiResponses.ts # Type-safe Gemini API response extraction
    toolErrors.ts    # Error formatting for tool responses
    textBlock.ts     # MCP text block helper
    usageFooter.ts   # Usage summary formatting
    redact.ts        # Sensitive data redaction
    filesystemAccess.ts # MCP roots-based filesystem access + diff apply helpers
    paths.ts         # Path expansion utilities
```

## Configuration

- Default config path: `~/.gemini-mcp-bridge/config.json` (override with `--config`)
- CLI flags: `--stdio` (default), `--http`, `--http-host`, `--http-port`, `--doctor`, `--check-api`, `--print-config`
- Backends:
  - `developer` (default): Gemini Developer API (`https://generativelanguage.googleapis.com/v1beta`)
  - `vertex`: Vertex AI (`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/{publisher}`) + project/location required

Filesystem (optional; off by default):

- `filesystem.mode=repo` enables repo-scoped server-side file reads using MCP roots (roots/list) as the allowlist.
- `filesystem.mode=system` enables machine-wide paths (requires `filesystem.allowSystem=true`; high risk).
- `filesystem.allowWrite=true` enables optional auto-apply for `gemini_code_fix` (diff approval remains the default).

Discoverability:

- `gemini://capabilities` exposes defaults, limits, filesystem mode, and prompt hints for clients.
- Tool JSON schemas advertise maxTokens caps (via `maximum`) and input size constraints in descriptions so clients can pre-validate requests.

## Architecture

### Core Components

- Config loader (`src/config.ts`) merges defaults, optional JSON config, and env overrides.
- Auth resolver (`src/auth/resolveAuth.ts`) resolves OAuth tokens (ADC) or API keys, including default key file paths.
- Gemini client (`src/services/geminiClient.ts`) wraps REST endpoints (generateContent/streamGenerateContent/countTokens/listModels/embedContent/predict), honors fallback policy, and adds `x-goog-user-project` for Vertex quota project routing.
- Tool handlers (`src/tools/*`) map MCP tools to Gemini API requests.
- Resources (`src/resources/*`) expose usage + discovery + per-model capabilities and conversation state.
- Rate limiting and budgets (`src/limits/*`) prevent runaway costs; daily budgets can be incremented with explicit approvals.

### Data Flow

1. MCP client calls a tool (e.g., `gemini_generate_text`).
2. Tool validates inputs and enforces rate limits and budgets.
3. Tool builds a Gemini API request (generateContent/streamGenerateContent/countTokens/listModels/embedContent; Vertex embeddings use predict).
4. Response is parsed and returned as MCP text blocks with a usage footer (if the model returns no text, tools surface block/finish reasons and can include raw response in debug mode).

### Filesystem Tools

- `gemini_code_review` and `gemini_code_fix` read local files on the server using MCP roots as the allowlist when `filesystem.mode=repo`.
- `gemini_code_fix` returns a unified diff by default; auto-apply requires `filesystem.allowWrite=true`.

### Streaming

- `gemini_generate_text_stream` uses Gemini `:streamGenerateContent` and parses SSE/streamed JSON.
- When the MCP client supplies `_meta.progressToken`, the tool emits `notifications/progress` with incremental text chunks.

### Conversation Memory

- `conversationId` routes requests through an in-memory conversation store.
- Conversations are bounded by `conversation.maxTurns` and `conversation.maxTotalChars`.
- State is process-local; use one bridge instance per user or session.
- Conversation management helpers are exposed via `gemini_conversation_*` tools and `conversation://*` resources.

### Provider-Agnostic Aliases

- `llm_*` tools are aliases that call the same Gemini-backed implementations (useful for clients that want stable tool names across providers).

## API Reference (Tools)

- `gemini_generate_text`: prompt, model, temperature/topK/topP/maxTokens, systemInstruction, jsonMode/strictJson/jsonSchema, grounding/includeGroundingMetadata, safetySettings, conversationId.
- `gemini_generate_text_stream`: streaming variant of `gemini_generate_text` (progress notifications when requested by the client).
- `gemini_generate_json`: strict JSON output (returns parsed JSON via `structuredContent`; clients should validate as needed).
- `gemini_analyze_image`: prompt + imageUrl/imageBase64 + mimeType; optional model/maxTokens.
- `gemini_embed_text`: text + optional model.
- `gemini_embed_text_batch`: texts[] + optional model.
- `gemini_count_tokens`: text + optional model.
- `gemini_count_tokens_batch`: texts[] + optional model.
- `gemini_list_models`: limit + pageToken; optional filter returns curated metadata and API call falls back to curated list on failure.
  - Curated metadata is refreshed daily (cached on disk) when API credentials are available.
- `gemini_moderate_text`: text + optional model/safetySettings; returns best-effort safety/block metadata.
- `gemini_code_review`: server-side code review over local files (requires filesystem.mode=repo + MCP roots).
- `gemini_code_fix`: propose fixes as a unified diff; optional auto-apply requires filesystem.allowWrite=true.
- `gemini_conversation_create|list|export|reset`: in-memory conversation management tools.
- `gemini_get_help`: topic (overview/tools/models/parameters/examples/quick-start).
- `llm_*`: provider-agnostic aliases for the tools above.

## Prompts

- `code_review`: args `code`, optional `language`.
- `explain_with_thinking`: args `topic`, optional `level`.
- `creative_writing`: args `prompt`, optional `style`/`length`.

## Resources

- `usage://stats`: token usage, per-tool breakdown.
- `conversation://list`: known conversation threads (in this server session).
- `conversation://current`: last active conversation state.
- `conversation://history/{id}`: conversation history by id.
- `gemini://capabilities`: capabilities, defaults, limits.
- `gemini://models`: configured model defaults.
- `gemini://model-capabilities`: curated per-model capabilities for client auto-configuration.
- `gemini://model/{name}`: curated capabilities for a single model.
- `gemini://help/*`: usage, parameters, examples.
- `llm://model-capabilities`: provider-agnostic capabilities reference.

## Build & Test

```
npm install
npm run build
npm test
npm run lint
```

## Tool Smoke

`scripts/tool-smoke.mjs` runs a live MCP client against the server (stdio by default, with optional HTTP fallback) and exercises all tools, resources, and prompts.

Common env overrides:

- `GEMINI_MCP_AUTH_FALLBACK=auto` to allow API key fallback during live checks.
- `TOOL_SMOKE_DEBUG=1` to enable server debug logging.
- `TOOL_SMOKE_TRACE=1` to trace client steps and include a tail of server stderr in the JSON report.
- `TOOL_SMOKE_CAPTURE_STDERR=1` to include the stderr tail without trace messages.
- `TOOL_SMOKE_TRANSPORT=auto|stdio|http` to select transport (auto tries stdio first and falls back to HTTP on connect failure).
- `TOOL_SMOKE_HTTP_HOST=127.0.0.1` and `TOOL_SMOKE_HTTP_PORT=...` to control the HTTP server when using HTTP mode (port defaults to a free ephemeral port).
- `TOOL_SMOKE_IMAGE_URL=...` or `TOOL_SMOKE_IMAGE_BASE64=...` (with `TOOL_SMOKE_IMAGE_MIME`) to override the default image.
- `GEMINI_MCP_TRACE_STARTUP=1` to log stdio startup state (stdin flags, end/close events) for diagnosing early disconnects.
- `GEMINI_MCP_EXIT_ON_STDIN=0` to suppress auto-exit on stdin end during debugging (not recommended outside diagnostics).

## Setup Wizard

- `gemini-mcp-bridge --setup` (or `npm run setup`) runs `scripts/setup.mjs` to guide
  sign-in selection, write the config file, optionally store an API key with consent,
  optionally run `gcloud` steps for Vertex, and optionally configure MCP client
  configs for one or more users.
- Vertex (gcloud/ADC) is the default sign-in path; API key fallback is optional.
- API keys are stored in `~/.gemini-mcp-bridge/api-key` by default (or `/etc/gemini-mcp-bridge/api-key` for shared use).
- Fallback policy defaults to `prompt`; users can switch to `auto` via the wizard or env.
- When configuring MCP clients, the wizard can optionally set a repo root for filesystem tools (auto-detects git root and asks for confirmation).
- The wizard uses ANSI color output when attached to a TTY; set `NO_COLOR=1` to disable.

## Security Notes

- Never log API keys or OAuth tokens; all logs go to stderr.
- Enforce max input sizes and image byte caps.
- Prefer header-based API keys (x-goog-api-key) to avoid URL leakage.
- Treat JSON mode output as untrusted; clients should validate schemas.
- Filesystem access is opt-in and should be treated as high risk. Default deny patterns block common credential/secret paths; users can override at their own risk.
- Auto-apply currently refuses new files and deletions; apply diffs manually for those changes.

## Maintenance Automation

### Daily Gemini API radar (GitHub Actions)

The repository includes a daily GitHub Actions workflow that checks the Gemini
Developer API model list (`/v1beta/models`) and diffs:

- Model additions/removals
- `supportedGenerationMethods` changes per model

When a meaningful change is detected (and a previous baseline exists), it opens
a GitHub issue labeled `gemini-api-radar` with a short summary and a link to the
workflow run (which uploads `radar-report.json` as an artifact).

Enable it:

- Add a repo secret `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- Ensure GitHub Actions are enabled

Files:

- Workflow: `.github/workflows/gemini-api-radar.yml`
- Script: `scripts/gemini-api-radar.mjs` (writes `.radar_cache/` which is gitignored)
