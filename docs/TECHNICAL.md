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
  tools/             # MCP tools (generate, analyze, embed, count, list, help)
  resources/         # MCP resources (usage, conversation, discovery)
  limits/            # Rate limiting + daily budgets (local + Redis)
  utils/
    toolHelpers.ts   # Shared tool utilities (validation, client, error handling)
    geminiResponses.ts # Type-safe Gemini API response extraction
    toolErrors.ts    # Error formatting for tool responses
    textBlock.ts     # MCP text block helper
    usageFooter.ts   # Usage summary formatting
    redact.ts        # Sensitive data redaction
    paths.ts         # Path expansion utilities
```

## Configuration

- Default config path: `~/.gemini-mcp-bridge/config.json` (override with `--config`)
- CLI flags: `--stdio` (default), `--http`, `--http-host`, `--http-port`, `--doctor`, `--check-api`, `--print-config`
- Backends:
  - `developer` (default): Gemini Developer API (`https://generativelanguage.googleapis.com/v1beta`)
  - `vertex`: Vertex AI (`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/{publisher}`) + project/location required

## Architecture

### Core Components

- Config loader (`src/config.ts`) merges defaults, optional JSON config, and env overrides.
- Auth resolver (`src/auth/resolveAuth.ts`) resolves OAuth tokens (ADC) or API keys.
- Gemini client (`src/services/geminiClient.ts`) wraps REST endpoints and error handling.
- Tool handlers (`src/tools/*`) map MCP tools to Gemini API requests.
- Resources (`src/resources/*`) expose usage + discovery metadata.
- Rate limiting and budgets (`src/limits/*`) prevent runaway costs.

### Data Flow

1. MCP client calls a tool (e.g., `gemini_generate_text`).
2. Tool validates inputs and enforces rate limits and budgets.
3. Tool builds a Gemini API request (generateContent/countTokens/listModels/embedContent).
4. Response is parsed and returned as MCP text blocks with a usage footer.

### Conversation Memory

- `conversationId` routes requests through an in-memory conversation store.
- Conversations are bounded by `conversation.maxTurns` and `conversation.maxTotalChars`.
- State is process-local; use one bridge instance per user or session.

## API Reference (Tools)

- `gemini_generate_text`: prompt, model, temperature/topK/topP/maxTokens, systemInstruction, jsonMode/jsonSchema, grounding, safetySettings, conversationId.
- `gemini_analyze_image`: prompt + imageUrl/imageBase64 + mimeType; optional model/maxTokens.
- `gemini_embed_text`: text + optional model.
- `gemini_count_tokens`: text + optional model.
- `gemini_list_models`: limit + pageToken; optional filter returns curated metadata and API call falls back to curated list on failure.
  - Curated metadata is refreshed daily (cached on disk) when API credentials are available.
- `gemini_get_help`: topic (overview/tools/models/parameters/examples/quick-start).

## Prompts

- `code_review`: args `code`, optional `language`.
- `explain_with_thinking`: args `topic`, optional `level`.
- `creative_writing`: args `prompt`, optional `style`/`length`.

## Resources

- `usage://stats`: token usage, per-tool breakdown.
- `conversation://current`: last active conversation state.
- `gemini://capabilities`: capabilities, defaults, limits.
- `gemini://models`: configured model defaults.
- `gemini://help/*`: usage, parameters, examples.

## Build & Test

```
npm install
npm run build
npm test
npm run lint
```

## Setup Wizard

- `npm run setup` runs `scripts/setup.mjs` to guide backend selection, write the
  config file, optionally run `gcloud` steps for Vertex, and optionally configure
  MCP client configs for one or more users.
- The wizard uses ANSI color output when attached to a TTY; set `NO_COLOR=1` to disable.

## Security Notes

- Never log API keys or OAuth tokens; all logs go to stderr.
- Enforce max input sizes and image byte caps.
- Prefer header-based API keys (x-goog-api-key) to avoid URL leakage.
- Treat JSON mode output as untrusted; clients should validate schemas.
