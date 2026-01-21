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

## 2026-01-21T11:00:13Z

- Attempted gemini_code_review; blocked by missing MCP roots; verification: not run; next: configure MCP roots or approve manual review

## 2026-01-21T11:15:57Z

- Documented MCP roots auto-root guidance and warnings across user manual/help/error messages; verification: not run; next: optionally run npm test/lint/build

## 2026-01-21T11:19:39Z

- Added instructions for changing MCP roots in docs/help/discovery; verification: not run; next: optionally run npm test/lint/build

## 2026-01-21T11:36:08Z

- Added client root config examples and auto-root setup (configure-mcp-users + setup wizard), including Gemini CLI config support; verification: not run; next: optionally run npm test/lint/build

## 2026-01-21T11:43:11Z

- Ran npm run build/test/lint (all passing) after fixing helpContent backtick parse error; next: decide scope/approach for configuring roots across projects

## 2026-01-21T11:58:31Z

- Attempted gemini_code_review; blocked by missing MCP roots; verification: not run; next: configure MCP roots or approve manual review

## 2026-01-21T12:44:34Z

- Add --setup CLI entrypoint and expand guided setup to store API key with consent, default Vertex auth, and repo-root wizard; update docs/help/README/CHANGELOG; verification: not run

## 2026-01-21T13:01:36Z

- Attempted system-wide install + all-users config; blocked by sudo password; ran npm run build; next: run sudo npm install -g /home/crismote/geminiMCPbridge and sudo node scripts/configure-mcp-users.mjs --all-users --no-codex --no-gemini-cli

## 2026-01-21T13:13:04Z

- Installed gemini-mcp-bridge globally and configured Claude Desktop + Claude Code for all users (no explicit roots); ran gemini-mcp-bridge --setup --backend vertex --project geminimcp-484312 --location us-central1 --non-interactive; verification: gemini-mcp-bridge --setup

## 2026-01-21T13:21:32Z

- Set Claude Code mcpContextUris to project paths for current user; claude desktop auto-roots needs UI + other users need update; ran gemini-mcp-bridge --doctor --check-api (ADC quota project missing)

## 2026-01-21T15:01:37Z

- Add default API key file discovery, fallback prompt, quota project header; update setup wizard/docs; verified: npm test -- src/services/geminiClient.test.ts src/auth/resolveAuth.test.ts; next: run gemini-mcp-bridge --doctor --check-api with cryptoking

## 2026-01-21T15:23:15Z

- Added budget approval prompts + approvals file + CLI; verified: npm test -- src/limits/dailyTokenBudget.test.ts src/limits/budgetApprovals.test.ts; next: run broader tests if needed

## 2026-01-21T15:28:56Z

- Fixed lint formatting + budget approval handler signature; verified: npm run build; npm run lint; npm test -- src/limits/dailyTokenBudget.test.ts src/limits/budgetApprovals.test.ts; next: none

## 2026-01-21T15:30:59Z

- Ran full test suite; verification: npm test (all passing); next: none

## 2026-01-21T15:47:08Z

- Reviewed full codebase and documentation for bugs and inconsistencies; verified tests pass; updated STATUS.md timestamp.

## 2026-01-21T16:03:25Z

- Installed globally and configured Codex + Gemini CLI for user crismote with root=/home/crismote; verified doctor check.

## 2026-01-21T16:10:04Z

- Ran build/lint/test for tool verification; verification: npm run build, npm run lint, npm test; next: run live tool checks once credentials/network approved

## 2026-01-21T16:19:40Z

- Added unit tests for analyzeImage, generateTextStream, countTokens, listModels, getHelp, conversation tools, alias tools; verification: npm test; next: optional live tool checks

## 2026-01-21T16:23:04Z

- Ran build and lint; verification: npm run build, npm run lint; next: optional live tool checks

## 2026-01-21T16:38:27Z

- Ran live tool smoke via scripts/tool-smoke.mjs; failures: gemini_generate_text + llm_generate_text (no text, finishReason=MAX_TOKENS), gemini_generate_text_stream + llm_generate_text_stream (no text), gemini_generate_json (Cannot read properties of undefined reading '_zod'), gemini_analyze_image + llm_analyze_image (Provided image is not valid), gemini_code_review + gemini_code_fix (MCP error -32601 method not found); verification: node scripts/tool-smoke.mjs; next: confirm whether to adjust smoke inputs or investigate tool issues

## 2026-01-21T17:20:39Z

- Enhanced tool-smoke (roots handler, debug flag, image URL override/default, JSON temps); removed gemini_generate_json outputSchema to avoid MCP output validation bug with non-object schemas; docs updated; verification: npm test; live checks: tool-smoke (quota/JSON/image failures noted)

## 2026-01-21T17:28:40Z

- Ran npm test and tool-smoke (debug). Failures: gemini_generate_json_schema + llm_generate_json invalid JSON; gemini_analyze_image + llm_analyze_image no text (finishReason=MAX_TOKENS). First non-debug run ended with connection closed. Verified: npm test; TOOL_SMOKE_DEBUG=1 GEMINI_MCP_AUTH_FALLBACK=auto node scripts/tool-smoke.mjs; next: decide whether to tune prompts/image or accept flake.

## 2026-01-21T17:41:05Z

- Updated tool-smoke: retry path + stricter JSON prompts/maxTokens; analyze_image prompt/maxTokens; new default image URL. Verified: TOOL_SMOKE_DEBUG=1 GEMINI_MCP_AUTH_FALLBACK=auto node scripts/tool-smoke.mjs (all pass). Next: none.

## 2026-01-21T17:53:21Z

- Ran tool-smoke without debug and with custom image URL override; both runs failed with MCP error -32000 (connection closed). Commands: GEMINI_MCP_AUTH_FALLBACK=auto node scripts/tool-smoke.mjs; GEMINI_MCP_AUTH_FALLBACK=auto TOOL_SMOKE_IMAGE_URL=https://www.gstatic.com/webp/gallery/2.jpg node scripts/tool-smoke.mjs. Next: decide whether to keep debug enabled or investigate connection close.

## 2026-01-21T18:23:17Z

- Investigated tool-smoke connection closed: added trace/capture + spawn args. TOOL_SMOKE_TRACE=1 GEMINI_MCP_AUTH_FALLBACK=auto node scripts/tool-smoke.mjs fails at client.connect (~400ms) with connection closed; transport close fires; child exit code=0, spawnargs=[node dist/index.js --stdio], server stderr empty. Suggests server exits cleanly during init (no output).

## 2026-01-21T20:16:03Z

- Documented tool-smoke env overrides/trace in TECHNICAL.md; committed and pushed (Add tool smoke harness and tests). Verification: not run.

## 2026-01-21T20:51:17Z

- Investigated stdio connection closed: added trace startup logging + optional stdin-exit override. Traces show stdin ends immediately after resume (readableEnded=true), even when spawned via StdioClientTransport; disabling stdin shutdown (GEMINI_MCP_EXIT_ON_STDIN=0) just causes client request timeout. Likely stdin EOF in non-interactive env; stdio not viable here without PTY/HTTP fallback.

## 2026-01-21T20:52:44Z

- Added stdio startup diagnostics/exit override + keepalive; updated TECHNICAL/CHANGELOG/STATUS; ran npm run build; committed and pushed.

## 2026-01-21T21:15:21Z

- Add HTTP fallback to tool-smoke + env options; docs updated; verification: GEMINI_MCP_AUTH_FALLBACK=auto TOOL_SMOKE_TRANSPORT=auto TOOL_SMOKE_TRACE=1 node scripts/tool-smoke.mjs (failed: stdio connection closed; HTTP listen EPERM 127.0.0.1); next: confirm environment allows HTTP binding

