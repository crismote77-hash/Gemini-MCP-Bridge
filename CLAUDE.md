# CLAUDE.md — Gemini MCP Bridge

Operational rules for coding agents working in this repository (Codex CLI, Claude Code, Gemini CLI, etc.).

This file mirrors `AGENTS.md`. Keep both files consistent.

---

## 0) Agent Rules (Read First)

- If the user asks a **question**, answer it first (with options/trade-offs). Do not turn questions into code changes automatically.
- Prefer small, verifiable changes (tests/lint/build) over large refactors.
- If requirements are unclear, list assumptions and ask for confirmation before implementing.
- Never introduce or expose secrets (API keys, OAuth tokens, ADC credentials, `.env` contents) in code, logs, tests, or docs.

**MCP hard rules:**
- When running as an MCP server, **stdout is reserved for JSON-RPC**. Logs must go to **stderr** only.
- Tool failures should return `{ isError: true, content: [...] }` (tool-level errors), not protocol-level exceptions.

---

## 1) Project Overview

`gemini-mcp-bridge` is a local MCP server that exposes Gemini model capabilities (text generation, image analysis, embeddings, token counting, model listing, help) to other AI CLIs via MCP.

Key capabilities:
- Tools: `gemini_generate_text`, `gemini_analyze_image`, `gemini_embed_text`, `gemini_count_tokens`, `gemini_list_models`, `gemini_get_help`
- Resources: `usage://stats`, `conversation://current`, `gemini://capabilities`, `gemini://models`, `gemini://help/*`
- Backends: Gemini Developer API (API key) and Vertex AI (OAuth/ADC + project/location)
- Guardrails: rate limits + daily token budgets (optional shared Redis store)

Canonical docs:
- Architecture/strategy: `docs/TECHNICAL.md`
- End-user usage/config: `docs/USER_MANUAL.md`
- Research notes: `docs/RESEARCH.md`
- Release notes: `docs/CHANGELOG.md`
- Progress tracking: `STATUS.md`
- Work log: `runbook.md`

---

## 2) Status + Runbook Discipline (Required)

This repo is run as a resumable project:

- `STATUS.md` is the single source of truth for progress and “Last verified”.
- `runbook.md` is append-only and rotating (use the script below).

Session routine:
1. Read latest `runbook.md` entries.
2. Update `STATUS.md` → mark what you will do as **In Progress**.
3. Make changes and verify (build/test/lint as applicable).
4. Update `STATUS.md` Verification Snapshot.
5. Append a runbook note:
   - `npm run runbook:note -- "What changed; verification; next step"`

Docs discipline:
- If you change architecture or behavior, update `docs/TECHNICAL.md` and/or `docs/USER_MANUAL.md` in the same PR.
- Update `docs/CHANGELOG.md` for user-facing changes.

---

## 3) Commands (Copy/Paste)

Node requirement: **Node.js >= 20**. Use **npm** (this repo uses `package-lock.json`).

```bash
# Install deps
npm install

# Build (TypeScript -> dist/)
npm run build

# Run server (uses config default transport; stdio is the norm)
npm start

# Dev mode (TypeScript watch)
npm run dev

# Tests (Vitest)
npm test
npm run test:watch

# Lint / format
npm run lint
npm run format

# MCP Inspector (manual validation)
npm run inspect

# Operational utilities
node dist/index.js --doctor
node dist/index.js --doctor --check-api
node dist/index.js --print-config

# Runbook entry (rotates automatically)
npm run runbook:note -- "Did X; verified with Y; next: Z"
```

---

## 4) Repository Map

```
src/
  index.ts            # CLI entry; stdio/http selection; doctor helpers
  server.ts           # McpServer creation + registrations
  config.ts           # Zod config schema + env/file merge
  logger.ts           # stderr logger + redaction
  httpServer.ts       # Streamable HTTP transport (opt-in)
  auth/               # OAuth/ADC + API key resolution
  models/             # curated model metadata + auto-refresh
  prompts/            # MCP prompts
  services/           # Gemini API client + conversation store
  tools/              # gemini_* tool implementations
  resources/          # usage://*, conversation://*, gemini://* discovery/help
  limits/             # rate limiting + daily budgets (local + Redis shared store)
  utils/              # shared helpers (redaction, base64, error mapping, etc.)
scripts/
  prebuild.mjs postbuild.mjs runbook-note.mjs
docs/
  TECHNICAL.md USER_MANUAL.md CHANGELOG.md RESEARCH.md
dist/
  (build output)
```

Tests are colocated as `src/**/*.test.ts` (Vitest).

---

## 5) Code Conventions (TypeScript / ESM)

- This repo is **ESM** (`"type": "module"`). Follow existing import style.
- Use **`.js` extensions in relative imports** inside `src/` (TypeScript compiles to ESM in `dist/`).
- Validate all tool inputs with **Zod** schemas. Reject invalid input early with clear messages.
- Prefer using `src/utils/toolHelpers.ts` for shared validation, budgeting, rate limiting, and client creation.

**Error handling (MCP):**
- Return tool errors with `isError: true` and safe, actionable messages.
- Don’t throw from tool handlers unless you intend a protocol-level failure (rare).

**Logging:**
- Server mode: **stderr only**. Avoid `console.log` in server execution paths.
- Never log API keys or OAuth tokens; keep redaction guarantees.

---

## 6) Adding or Changing Tools/Resources

When adding a tool:
1. Create `src/tools/<tool>.ts`
2. Register in `src/tools/index.ts`
3. Add tests as `src/**/<thing>.test.ts`
4. Update user docs: `docs/USER_MANUAL.md` (tool reference + examples)
5. Update technical docs: `docs/TECHNICAL.md` (internals/architecture)
6. Update `docs/CHANGELOG.md`

When changing public surface area (tool params/results, resources, config keys):
- Update tests and docs in the same PR.
- Re-run `npm run build`, `npm test`, `npm run lint`.

---

## 7) Security & Data Handling

- Treat API keys and OAuth/ADC tokens as secrets (never commit; never print).
- Prefer header-based API keys (`x-goog-api-key`) and avoid URL query leakage.
- Treat JSON-mode output as untrusted; clients should validate schema.
- Enforce max input sizes and image byte/mime caps (don’t relax limits without reason).

Backend/auth gotchas:
- Developer API is best with API keys; OAuth tokens may lack the correct scopes.
- Vertex backend is best with OAuth/ADC (`gcloud auth application-default login`) but requires project/location.

---

## 8) No-Touch / High-Risk Areas (Confirm Before Big Changes)

- `dist/`: generated build output. Do not edit manually (change `src/` instead).
- `package-lock.json`: do not hand-edit; update via `npm install` when required.
- Auth and credential handling (`src/auth/*`): changes here can cause credential leakage or break connectivity.
- Transport wiring (`src/index.ts`, `src/httpServer.ts`): mistakes can break MCP protocol compatibility.

---

## 9) References

- Gemini API docs: https://ai.google.dev/api
- MCP spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- MCP TS SDK: https://github.com/modelcontextprotocol/typescript-sdk
