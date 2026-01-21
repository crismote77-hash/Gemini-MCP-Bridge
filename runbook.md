# Runbook (Rotating)

## Runbook Index
- (none yet)


Start using `npm run runbook:note -- "..."` to append entries.

---

## 2026-01-19T18:35:50Z

- Created geminiMCPbridge with Gemini tools/resources/limits/auth/config, added docs + research notes; tests not run.

## 2026-01-19T07:04:21Z

- Fixed lint/test issues, ran build/test/lint, installed gemini-mcp-bridge globally for current user (npm -g), updated Codex ~/.codex/config.toml to use gemini-mcp-bridge, and updated Claude Desktop ~/.config/Claude/claude_desktop_config.json to add gemini MCP server.

## 2026-01-19T11:40:13Z

- Ran npm test, all 53 tests passed.

## 2026-01-19T11:46:56Z

- Installed gemini-mcp-bridge globally, verified Codex config, and updated Claude Desktop config.

## 2026-01-19T11:48:26Z

- Ran npm test to validate Gemini MCP tools; verification: npm test; next: none

## 2026-01-19T13:07:08Z

- Added npm run setup wizard for backend config and optional gcloud steps; verification: not run; next: run gemini-mcp-bridge --doctor --check-api

## 2026-01-19T13:21:38Z

- Improved setup wizard UX with guidance, masked values, WSL note, and git-path warning; verification: not run; next: run npm run setup

## 2026-01-19T13:22:47Z

- Refined setup wizard masking (project/location) and clarified config-path tip; verification: not run; next: run npm run setup

## 2026-01-19T13:32:12Z

- Updated setup wizard with numbered menus, multi-user client config step, and additional guidance; verification: not run; next: run npm run setup

## 2026-01-19T13:41:05Z

- Renamed MCP server display name to gemini-bridge, updated Codex/Claude CLI config examples; verification not run

## 2026-01-19T13:42:01Z

- Added ANSI color cues to setup wizard prompts/tips/results and documented NO_COLOR; verification: not run; next: run npm run setup

## 2026-01-19T13:43:39Z

- Refined setup wizard color usage for tips/warnings and numbered prompts; verification: not run; next: run npm run setup

## 2026-01-19T14:34:49Z

- Fixed docs/code inconsistencies (listModels fallback, server name default, vertex env support), updated docs/base URLs and tests; verification: npm test; next: none

## 2026-01-19T14:53:26Z

- Ignored .serena in git and removed tracked metadata files; verification not run

## 2026-01-19T19:38:36Z

- Fix Vertex embeddings (gemini_embed_text uses predict) + clearer non-JSON API errors; verified: npm run build, npm test; next: re-test MCP tools in Claude/Codex

## 2026-01-19T20:01:19Z

- Fix empty outputs: generate_text/analyze_image now error with block/finish reasons when no text; tool errors surface redacted messages; verified: npm run build, npm test; next: re-test gemini_generate_text + gemini_analyze_image in Claude

## 2026-01-19T20:10:37Z

- Harden gemini_list_models on Vertex: retry alternate aiplatform endpoints on 404 before curated fallback; added test; verified: npm run build, npm test; next: re-test gemini_list_models in Codex/Claude

## 2026-01-19T21:19:29Z

- Added daily Gemini API radar (GitHub Actions) to diff /v1beta/models and open an issue; verified: npm run build, npm test; next: add GEMINI_API_KEY secret in GitHub and verify scheduled run

## 2026-01-19T22:17:48Z

- Added streaming/json/batch/moderation/conversation tools + llm_* aliases + model capability resources; verified: npm run build, npm test, npm run lint; next: re-test tools in Claude/Codex

## 2026-01-19T22:25:17Z

- Configured Codex + Claude Desktop to run gemini server from /home/crismote/geminiMCPbridge/dist/index.js; next: restart Codex + Claude Desktop to pick up changes
## 2026-01-21T07:45:44Z

- Fix jsonSchema/strictJson to imply JSON mode + unwrap schema wrappers; add tests/docs; verified: npm run build, npm test, npm run lint; next: restart bridge

## 2026-01-21T08:00:04Z

- Raise default maxTokensPerRequest to 8192 + improve maxTokens limit error message; verified: npm run build, npm test, npm run lint; next: restart bridge

## 2026-01-21T08:09:53Z

- Advertise maxTokens caps + prompt hints in MCP tool schemas and gemini://capabilities; verified: npm run build, npm test, npm run lint; next: restart bridge and re-test client behavior

## 2026-01-21T09:23:46Z

- Add repo-roots filesystem mode + gemini_code_review/gemini_code_fix (diff approval + optional auto-apply); verified: npm run build, npm test, npm run lint; next: restart bridge and try tools in Claude Desktop + Codex CLI

## 2026-01-21T09:33:12Z

- Audit docs/codebase for inconsistencies; update README/User Manual/Technical docs and capabilities notes for filesystem tools; verified: npm run build, npm test, npm run lint; next: restart bridge and re-test in clients

## 2026-01-21T10:23:15Z

- Sync AGENTS/CLAUDE + USER_MANUAL/TECHNICAL for install options and capability/limit discoverability; verified: doc-only (no tests); next: commit + push

## 2026-01-21T10:54:53Z

- Verified npm run build/test/lint after doc sync; next: none

