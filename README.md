# Gemini MCP Bridge

Local MCP server that exposes Gemini models to AI CLIs via MCP.

## Quick Start

1. `npm install -g gemini-mcp-bridge`
2. Authenticate (default: OAuth/ADC subscription login):
   - `gcloud auth application-default login`
   - or set `GEMINI_API_KEY=...`
3. `gemini-mcp-bridge --stdio`
4. Configure your CLI to call `gemini-mcp-bridge`
5. Use `gemini_generate_text` in your CLI

## Features

- Text generation, image analysis, embeddings, model listing, token counting
- Discoverability resources and built-in help
- Rate limits and daily token budgets (optional shared Redis store)

## Documentation

- [User Manual](docs/USER_MANUAL.md)
- [Technical Docs](docs/TECHNICAL.md)
- [Changelog](docs/CHANGELOG.md)

## License

MIT
