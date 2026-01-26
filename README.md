# Gemini MCP Bridge

Local MCP server that exposes Gemini models to AI CLIs via MCP.

## Quick Start

1. `npm install -g gemini-mcp-bridge`
2. Run guided setup: `gemini-mcp-bridge --setup`
3. `gemini-mcp-bridge --stdio`
4. Configure your CLI to call `gemini-mcp-bridge`
5. Use `gemini_generate_text` in your CLI

If you do not have permission to install globally, install to a user prefix and
point your MCP client at the full command path:

```
npm install -g gemini-mcp-bridge --prefix ~/.npm-global
# Then set command = "$HOME/.npm-global/bin/gemini-mcp-bridge" in your MCP client config.
```

Manual auth (advanced):
- Subscription/OAuth (Gemini CLI-style): use Vertex backend (`gcloud auth application-default login` + `GEMINI_MCP_BACKEND=vertex` + `GEMINI_MCP_VERTEX_PROJECT=...` + `GEMINI_MCP_VERTEX_LOCATION=...`)
- API key: save to `~/.gemini-mcp-bridge/api-key` (or `/etc/gemini-mcp-bridge/api-key` for shared use), or set `GEMINI_API_KEY=...` / `GOOGLE_API_KEY=...` (Developer backend)

## Installation for AI Agents

If you are an AI agent installing this for a user, please consult **[AGENTS.md](AGENTS.md)** for critical setup protocols.
- **Important:** You must explicitly configure the project root using `GEMINI_MCP_FS_ROOT` in the server environment to avoid "No MCP roots available" errors. See [User Manual > Configuration](docs/USER_MANUAL.md#configuring-root-folder-ci--agents--manual).

## Guided Setup (from source)

If you are running from this repo, the setup wizard can guide backend selection,
write `~/.gemini-mcp-bridge/config.json`, optionally store an API key with consent,
and optionally run `gcloud` steps for Vertex:

```
gemini-mcp-bridge --setup

# Or from source:
npm run setup
```

## Features

- Text generation, image analysis, embeddings, model listing, token counting
- Optional repo-scoped filesystem access via MCP roots for server-side code review/fix
- Compound tools: `gemini_code_review` (review) and `gemini_code_fix` (diff-based fixes)
- OAuth/ADC (subscription) auth with API key fallback in `auto` mode (warns on modality change)
- Discoverability resources and built-in help
- Rate limits and daily token budgets (optional shared Redis store)
- Budget approvals via `gemini-mcp-bridge --approve-budget`
- Centralized error logging with rotation, retention, and redaction

## Documentation

- [User Manual](docs/USER_MANUAL.md)
- [Technical Docs](docs/TECHNICAL.md)
- [Changelog](docs/CHANGELOG.md)

## License

MIT
