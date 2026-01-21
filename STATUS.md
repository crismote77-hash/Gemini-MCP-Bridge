# Project Status

Last updated (UTC): 2026-01-21T20:15:24Z

## In Progress

- (none)

## Pending

- [blocked] Project-wide code review via gemini_code_review. DoD: Findings list with file/line references. Reason: missing MCP roots for repo-scoped code review tool.
- [pending] Verify review findings in source for severity/accuracy. DoD: Confirmed with file/line refs or dismissed.
- [pending] Configure MCP roots for all projects (needs project scope/approach confirmation)
- [pending] Enable workspace auto-roots for Claude Desktop (UI setting) and update Claude Code mcpContextUris for other users. DoD: Desktop auto-roots on; .claude.json updated for remaining users.

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
- Document MCP roots auto-configuration guidance and user-facing warnings for filesystem tools.
- Add instructions for changing MCP roots in user-facing docs/help.
- Add client-specific MCP roots examples and auto-root configuration via setup/configure scripts.
- Guided setup + CLI entrypoint for beginner-friendly install (Vertex default + API key fallback + repo root wizard).
- Install gemini-mcp-bridge globally (system-wide) and configure Claude Desktop + Claude Code for all users with workspace auto-roots (no explicit roots).
- Enable Claude Code workspace roots for current user and run doctor check (quota project missing).
- Add global API key file discovery, prompt fallback policy, system key storage option, and Vertex quota project header; update setup/docs/tests.
- [completed] Add daily budget approval prompts + approvals file + CLI hook. DoD: npm test -- src/limits/dailyTokenBudget.test.ts src/limits/budgetApprovals.test.ts; Planner/Critic/Verifier: prompt policy + approvals file + CLI, ensure no secrets, tests passed.
- Installed app globally and configured Codex/Gemini CLI for user `crismote` (root: `/home/crismote`).
- Run local verification (build/lint/test) for tools/features.
- Add unit tests for remaining tools/aliases and rerun npm test.
- Run live tool checks across gemini_* and llm_* (see runbook for failures).
- Tune tool-smoke inputs and add roots handling + image URL overrides.
- Remove gemini_generate_json output schema to avoid MCP output validation bug; update docs.
- Run full tool + feature verification (unit + live) with tool-smoke failures documented (JSON schema + analyze_image max tokens).
- Tune tool-smoke JSON schema prompts + retry, adjust analyze_image prompt/maxTokens/default image; rerun tool-smoke (pass).
- Attempt tool-smoke without debug and with custom image override (both runs ended with connection closed).
- Investigate tool-smoke connection closed with trace/capture; connect fails with connection closed, server exits code 0, spawn args correct, no stderr output.
- Document tool-smoke env overrides and trace/capture in TECHNICAL.md.

## Verification Snapshot

Last verified (UTC): 2026-01-21T18:23:02Z

- TOOL_SMOKE_TRACE=1 GEMINI_MCP_AUTH_FALLBACK=auto node scripts/tool-smoke.mjs (failed: connection closed)
