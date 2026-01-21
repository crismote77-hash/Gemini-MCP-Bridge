# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffolding
- Core MCP server (stdio + optional streamable HTTP)
- Guided setup wizard (`npm run setup`) for backend configuration and optional Vertex `gcloud` steps
- CLI entrypoint `gemini-mcp-bridge --setup` for guided setup
- Config loader with env overrides and strict parsing
- Auth resolver for Gemini API keys
- OAuth/ADC authentication with auth mode selection (oauth/apiKey/auto)
- MCP prompts: code_review, explain_with_thinking, creative_writing
- Curated Gemini model metadata for filtered listings
- Daily auto-refresh for curated Gemini model metadata cache
- Daily GitHub Actions “radar” that detects Gemini API model/capability changes and auto-opens a GitHub issue
- Rate limiter + daily token budget (optional shared Redis)
- Vertex backend (`GEMINI_MCP_BACKEND=vertex`) for Gemini via Vertex AI using OAuth/ADC (subscription / gcloud), with Developer API key fallback support in `auto` mode
- Tools: gemini_generate_text, gemini_analyze_image, gemini_embed_text, gemini_count_tokens, gemini_list_models, gemini_get_help
- Resources: usage://stats, conversation://current, gemini://capabilities, gemini://models, gemini://help/*
- Research notes in docs/RESEARCH.md
- Shared tool helper utilities (`src/utils/toolHelpers.ts`) for input validation, client creation, rate limiting, and error handling
- `RedisConnectionError` class for clear Redis connection failure identification
- `HttpServerError` class with descriptive messages for port binding errors
- Proper TypeScript types for Gemini API responses (`GeminiResponse`, `GeminiCandidate`, etc.)
- Type guard `isRateLimitEvalResult()` for Redis eval response validation
- Base64 validation (`isValidBase64`, `decodeBase64Safely`) for image uploads
- `connectTimeoutMs` optional config parameter for Redis connections
- Streaming generation support via Gemini `:streamGenerateContent` (SSE/streamed JSON parsing in the Gemini client).
- New tools: `gemini_generate_text_stream`, `gemini_generate_json`, `gemini_embed_text_batch`, `gemini_count_tokens_batch`, `gemini_moderate_text`.
- Conversation management tools: `gemini_conversation_create`, `gemini_conversation_list`, `gemini_conversation_export`, `gemini_conversation_reset`.
- Provider-agnostic alias tools prefixed with `llm_` (e.g. `llm_generate_text`, `llm_generate_json`, `llm_embed_text_batch`).
- New resources: `conversation://list`, `conversation://history/{id}`, `gemini://model-capabilities`, `gemini://model/{name}`, `llm://model-capabilities`.
- New opt-in filesystem support (repo-scoped via MCP roots; optional machine-wide “system” mode) and compound tools:
  - `gemini_code_review`: server-side repo code review without the caller sending file contents.
  - `gemini_code_fix`: returns `{ summary, diff }` and can optionally auto-apply when `filesystem.allowWrite=true`.
- Default API key file discovery (`~/.gemini-mcp-bridge/api-key` and `/etc/gemini-mcp-bridge/api-key`) and fallback policy control (`auto|prompt|never`).
- Vertex quota project routing via `vertex.quotaProject` / `GEMINI_MCP_VERTEX_QUOTA_PROJECT` (adds `x-goog-user-project` header).
- Budget approval prompts and `gemini-mcp-bridge --approve-budget` for incremental daily budget increases.
- Diagnostic startup tracing envs: `GEMINI_MCP_TRACE_STARTUP` and `GEMINI_MCP_EXIT_ON_STDIN`.

### Changed

- Tool smoke script supports HTTP transport mode with stdio fallback, plus new env overrides for transport/host/port.
- Setup wizard output now includes guided explanations, numbered menus, masked detected values, git-path warnings, optional multi-user MCP client configuration, and ANSI color cues (disable with `NO_COLOR=1`).
- Setup wizard now defaults to Vertex sign-in with optional API key fallback, supports saving API keys with explicit consent (masked input), and can enable repo tools with auto-detected root confirmation.
- Setup wizard now saves API keys to key files (user or system) with explicit consent and captures fallback policy + quota project.
- MCP server now reports its name as `gemini-bridge` in discovery/handshake output.
- Default `limits.maxTokensPerRequest` increased to 8192 (override with `GEMINI_MCP_MAX_TOKENS` / config file).
- Tool input schemas now advertise maxTokens caps and prompt-structure hints (helps MCP clients/LLMs avoid invalid requests).
- `gemini://capabilities` now advertises filesystem mode and the new compound review/fix tools when enabled.
- User-facing docs/help now include client-specific root config examples, how to change roots, and setup/config scripts for auto-setting roots.
- Setup/config scripts now include optional repo-root configuration and Gemini CLI client updates.
- Redis connection now uses 10-second timeout with `Promise.race()` and re-throws errors instead of silently failing
- HTTP server transport cleanup uses `Promise.allSettled()` for robust iteration
- Rate limiter uses `filter()` instead of repeated `shift()` for efficiency, with hard cap on array size
- Replaced `any` types with `unknown` + type guards in Gemini response handling
- HTTP server type casts replaced with documented `adaptToTransport()` adapter function
- Unified logging: all resource handlers now use injected `Logger` instead of `console.error()`
- Standardized API pattern: `recordUsage()` calls changed to `commit()` in tools
- Standardized error variable naming: all catch blocks use `error` instead of `err`
- Refactored `countTokens` and `listModels` tools to use shared helper utilities
- `gemini_list_models` supports curated filtering and falls back to curated metadata on API failure
- `gemini_generate_text` supports `strictJson` (optional JSON validation) and `includeGroundingMetadata` (best-effort grounding metadata extraction).

### Fixed

- `gemini_embed_text` now uses Vertex `predict` when `GEMINI_MCP_BACKEND=vertex` (previously failed with embedContent unsupported errors).
- Gemini client now surfaces clearer errors when the API returns non-JSON responses (instead of JSON parse exceptions).
- `gemini_generate_text` and `gemini_analyze_image` now return a clear error (with `blockReason` / `finishReason`) when the API returns no text, instead of returning an empty string.
- Tool errors now surface safe underlying error messages (redacted) for easier debugging (e.g. image URL fetch failures).
- `jsonSchema` now implies JSON mode for `gemini_generate_text` / `gemini_generate_text_stream`, and schema wrapper objects are unwrapped for structured output requests.
- `gemini_list_models` now retries alternate Vertex endpoints when the API returns a 404 HTML response (reduces fallback-to-curated warnings on some setups).
- Redis connection hangs indefinitely if server is unavailable (now times out after 10s)
- HTTP server shows cryptic errors for port conflicts (now shows user-friendly messages for EADDRINUSE, EACCES, EADDRNOTAVAIL)
- Conversation trimming infinite loop when single message exceeds `maxTotalChars` (now truncates oversized messages)
- Rate limiter memory leak from unbounded timestamps array growth
- Invalid base64 image data causes unclear errors (now validates format before decoding)
- Unexpected Redis eval response format causes silent failures (now throws descriptive error)
- Input size checks now include conversation history for `gemini_generate_text`.
- Conversation truncation handles very small `maxTotalChars` without negative slicing.
- `gemini_count_tokens` defaults to the configured model when none is provided.
- `--doctor` output reports both `GEMINI_MCP_OAUTH_TOKEN` and `GOOGLE_OAUTH_ACCESS_TOKEN`.
- Help parameter docs list `maxTokens` for `gemini_analyze_image` and `filter` for `gemini_list_models`.
- OAuth cache memory leak from unbounded cache growth (now uses LRU eviction with max 100 entries)
- Image token estimation ignoring image data size (now estimates ~750 base64 bytes per token)
- Missing rate limit check for curated model listings
- Confusing `GEMINI_MCP_API_KEY_FILE` env var renamed to `GEMINI_MCP_API_KEY_FILE_ENV_VAR` for clarity
- Duplicate `isRecord` type guard functions consolidated into shared `utils/typeGuards.ts`
- Duplicate `ToolDependencies` type definitions consolidated (tools/index.ts extends utils/toolHelpers.ts)
- Unused `estimateTokens` function and `tokenEstimate.ts` file removed
- `gemini_list_models` fallback responses now return curated data as a non-error with an explicit warning.
- `configure-mcp-users.mjs` now defaults to the `gemini-bridge` server name to match discovery output.
- Vertex location resolution now honors `CLOUDSDK_COMPUTE_REGION` (in addition to `GEMINI_MCP_VERTEX_LOCATION` and `GOOGLE_CLOUD_LOCATION`).
- Stdio server now keeps the process alive until stdin closes to prevent early exits during client initialization.

## [0.1.0] - TBD

### Added

- Initial release
