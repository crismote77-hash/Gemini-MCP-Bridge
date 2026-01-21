# Gemini MCP Bridge

Local MCP server that exposes Gemini models to AI CLIs via MCP.

## Quick Start

1. `npm install -g gemini-mcp-bridge`
2. Authenticate:
   - Subscription/OAuth (Gemini CLI-style): use Vertex backend (`gcloud auth application-default login` + `GEMINI_MCP_BACKEND=vertex` + `GEMINI_MCP_VERTEX_PROJECT=...` + `GEMINI_MCP_VERTEX_LOCATION=...`)
   - API key (simplest): `GEMINI_API_KEY=...` (or `GOOGLE_API_KEY=...`) (Developer backend)
3. `gemini-mcp-bridge --stdio`
4. Configure your CLI to call `gemini-mcp-bridge`
5. Use `gemini_generate_text` in your CLI

## Guided Setup (from source)

If you are running from this repo, the setup wizard can guide backend selection,
write `~/.gemini-mcp-bridge/config.json`, and optionally run `gcloud` steps for
Vertex:

```
npm run setup
```

## Features

- Text generation, image analysis, embeddings, model listing, token counting
- Optional repo-scoped filesystem access via MCP roots for server-side code review/fix
- Compound tools: `gemini_code_review` (review) and `gemini_code_fix` (diff-based fixes)
- OAuth/ADC (subscription) auth with API key fallback in `auto` mode (warns on modality change)
- Discoverability resources and built-in help
- Rate limits and daily token budgets (optional shared Redis store)

## Documentation

- [User Manual](docs/USER_MANUAL.md)
- [Technical Docs](docs/TECHNICAL.md)
- [Changelog](docs/CHANGELOG.md)

## License

MIT
