# Runbook (Rotating)

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

