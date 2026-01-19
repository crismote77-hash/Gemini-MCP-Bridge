# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffolding
- Core MCP server (stdio + optional streamable HTTP)
- Config loader with env overrides and strict parsing
- Auth resolver for Gemini API keys
- OAuth/ADC authentication with auth mode selection (oauth/apiKey/auto)
- MCP prompts: code_review, explain_with_thinking, creative_writing
- Curated Gemini model metadata for filtered listings
- Rate limiter + daily token budget (optional shared Redis)
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

### Changed

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

### Fixed

- Redis connection hangs indefinitely if server is unavailable (now times out after 10s)
- HTTP server shows cryptic errors for port conflicts (now shows user-friendly messages for EADDRINUSE, EACCES, EADDRNOTAVAIL)
- Conversation trimming infinite loop when single message exceeds `maxTotalChars` (now truncates oversized messages)
- Rate limiter memory leak from unbounded timestamps array growth
- Invalid base64 image data causes unclear errors (now validates format before decoding)
- Unexpected Redis eval response format causes silent failures (now throws descriptive error)

## [0.1.0] - TBD

### Added

- Initial release
