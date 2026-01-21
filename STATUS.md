# Project Status

Last updated (UTC): 2026-01-21T10:54:43Z

## In Progress

- None

## Pending

- None

## Done

- P0.1 Implement core MCP server + config + auth
- P0.2 Implement Gemini tools (generate_text, analyze_image, embed_text, count_tokens, list_models, get_help)
- P0.3 Implement resources (usage + discovery)
- P0.4 Add limits (rate limiter + daily budget + shared store)
- P0.5 Docs (USER_MANUAL, TECHNICAL, CHANGELOG, RESEARCH)
- P0.6 Tests + verification
- Add guided setup script for backend configuration
- Improve setup wizard guidance and privacy defaults
- Add numbered menus and multi-user MCP client setup
- Add color-coded setup output
- Rename MCP server display name to gemini-bridge and update CLI docs examples
- Review documentation/codebase for inconsistencies and fix bugs per AGENTS rules.
- Ignore .serena metadata in git and remove tracked files
- Fix `gemini_embed_text` for Vertex backend (use Vertex embedding API).
- Improve non-JSON Gemini API error handling (avoid confusing JSON parse errors).
- Improve `gemini_generate_text` handling when no text is returned (surface block/finish reasons instead of empty output).
- Improve `gemini_analyze_image` error messages (surface safe underlying errors like image fetch failures).
- Retry `gemini_list_models` against alternate Vertex endpoints on 404 before falling back to curated metadata.
- Add daily GitHub Actions “radar” to detect Gemini API model/capability changes and auto-open a GitHub issue.
- Add streaming + structured JSON tools (plus provider-agnostic `llm_*` aliases)
- Add batch token/embedding tools
- Add conversation management tools and resources
- Add model capabilities resources and moderation tool
- Fix JSON mode/schema handling for `jsonSchema`/`strictJson` requests (including schema wrapper unwrapping and clearer schema-related errors).
- Raise default `maxTokensPerRequest` cap to 8192 (override via `GEMINI_MCP_MAX_TOKENS` / config).
- Advertise tool limits/usage via MCP tool schemas (maxTokens caps + prompt hints).
- Add opt-in filesystem access (repo-scoped via MCP roots; optional system mode) and compound tools for code review + diff fixes (with optional auto-apply).
- Audit docs/codebase for inconsistencies/missing info; align help/resources/docs with filesystem tools + capabilities notes.
- Sync AGENTS/CLAUDE + USER_MANUAL/TECHNICAL for install options and capability/limit discoverability.
- Verify main after doc sync (npm run build/test/lint).

## Verification Snapshot

Last verified (UTC): 2026-01-21T10:54:43Z

- npm run build
- npm test
- npm run lint
