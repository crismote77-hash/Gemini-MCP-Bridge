# Gemini MCP Bridge

Local MCP server that exposes Gemini models to AI CLIs via MCP.

## Quick Start

1. `npm install -g gemini-mcp-bridge`
2. Run guided setup: `gemini-mcp-bridge --setup`
3. `gemini-mcp-bridge --stdio`
4. Configure your CLI to call `gemini-mcp-bridge`
5. Use `gemini_generate_text` in your CLI

Manual auth (advanced):
- Subscription/OAuth (Gemini CLI-style): use Vertex backend (`gcloud auth application-default login` + `GEMINI_MCP_BACKEND=vertex` + `GEMINI_MCP_VERTEX_PROJECT=...` + `GEMINI_MCP_VERTEX_LOCATION=...`)
- API key: save to `~/.gemini-mcp-bridge/api-key` (or `/etc/gemini-mcp-bridge/api-key` for shared use), or set `GEMINI_API_KEY=...` / `GOOGLE_API_KEY=...` (Developer backend)

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

## Documentation

- [User Manual](docs/USER_MANUAL.md)
- [Technical Docs](docs/TECHNICAL.md)
- [Changelog](docs/CHANGELOG.md)

## License

MIT
