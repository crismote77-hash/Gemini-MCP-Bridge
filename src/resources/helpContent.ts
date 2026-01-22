export const HELP_USAGE = `# Gemini MCP Bridge Help

## Quick Start
- Run gemini-mcp-bridge --setup for guided setup (Vertex default + optional API key fallback).
- Use gemini_generate_text for core text generation.
- Use gemini_generate_text_stream for incremental progress updates (clients must request progress notifications).
- Use gemini_generate_json for strict JSON output via structuredContent.
- Use gemini_analyze_image for multimodal prompts.
- Use gemini_embed_text for embeddings (Developer: embedContent; Vertex: predict).
- Use gemini_embed_text_batch for batch embeddings.
- Use gemini_count_tokens for token estimates.
- Use gemini_count_tokens_batch for batch token estimates.
- Use gemini_list_models for available models.
- Use gemini_moderate_text for safety/block metadata (best-effort).
- Use gemini_code_review to review local repo code (server reads files via MCP roots when enabled).
- Use gemini_code_fix to propose fixes as a unified diff (optional auto-apply when enabled).
- Use gemini_conversation_* tools to create/list/export/reset in-memory threads.
- Use gemini_get_help for built-in help.

## Filesystem Roots (repo tools)
- Repo tools (gemini_code_review / gemini_code_fix) require filesystem.mode=repo plus MCP roots from your client.
- Configure your MCP client to send a single repo/workspace root; many clients support auto-roots to the current workspace.
- Warning: auto-roots can over-share in multi-repo or home-directory contexts; keep roots narrow and only enable for trusted servers.
- If you see "No MCP roots available" or "Multiple MCP roots", adjust client roots or use separate server entries per project.
- To change roots, update your MCP client config (often a roots/workspace setting) and restart the client.
- Run gemini-mcp-bridge --setup or node scripts/configure-mcp-users.mjs --root-git/--root-cwd to set roots automatically.

## Provider-Agnostic Aliases
- llm_* tools are aliases to the Gemini tools above (useful for clients that want stable names across providers).

## Authentication & Backend
- Default backend is the Gemini Developer API. Use an API key via GEMINI_API_KEY (or GOOGLE_API_KEY), or save it to ~/.gemini-mcp-bridge/api-key (or /etc/gemini-mcp-bridge/api-key for shared use).
- To use gcloud/ADC (subscription) credentials, set GEMINI_MCP_BACKEND=vertex and configure GEMINI_MCP_VERTEX_PROJECT + GEMINI_MCP_VERTEX_LOCATION.
- In GEMINI_MCP_AUTH_MODE=auto, the bridge can retry with an API key if OAuth/ADC fails (and will warn on modality change).
- Control fallback behavior with GEMINI_MCP_AUTH_FALLBACK=auto|prompt|never (default: prompt).

## Usage Limits
- The daily token budget is a bridge safety limit (separate from model context windows).
- When the budget is reached and approval is set to prompt, run: gemini-mcp-bridge --approve-budget (adds another 200,000 tokens for today by default).
- Control approval behavior with GEMINI_MCP_BUDGET_APPROVAL_POLICY=auto|prompt|never.

## Error Logging
- Enable error logging with GEMINI_MCP_ERROR_LOGGING=errors|debug|full (default: off).
- Logs are stored in a platform-specific directory (Linux: ~/.local/state/gemini-mcp-bridge/logs).
- Logs are rotated daily (or when >10MB) and redacted for privacy.
- Customize with GEMINI_MCP_LOG_DIR, GEMINI_MCP_LOG_MAX_SIZE (MB), GEMINI_MCP_LOG_RETENTION (days).

## Discoverability
- Read gemini://capabilities for server features.
- Read gemini://models for configured defaults.
- Read gemini://model-capabilities for curated per-model capabilities.
- Read gemini://help/parameters for tool inputs.
`;

export const HELP_PARAMETERS = `# Parameters Reference

## gemini_generate_text
- prompt (string, required)
- model (string, optional)
- temperature, topK, topP, maxTokens (optional; maxTokens must be <= limits.maxTokensPerRequest, see gemini://capabilities)
- systemInstruction (string, optional)
- jsonMode (boolean, optional)
- strictJson (boolean, optional; implies jsonMode=true; errors if output is not valid JSON)
- jsonSchema (object, optional; implies jsonMode=true; JSON Schema for structured output)
- grounding (boolean, optional)
- includeGroundingMetadata (boolean, optional)
- conversationId (string, optional)
- safetySettings (array, optional)

## gemini_generate_text_stream
- Same parameters as gemini_generate_text.
- Emits notifications/progress when the client supplies a progressToken in the MCP request _meta.

## gemini_generate_json
- prompt (string, required)
- model (string, optional)
- temperature, topK, topP, maxTokens (optional; maxTokens must be <= limits.maxTokensPerRequest, see gemini://capabilities)
- systemInstruction (string, optional)
- jsonSchema (object, optional; JSON Schema for structured output)
- grounding (boolean, optional)
- includeGroundingMetadata (boolean, optional)
- conversationId (string, optional)
- safetySettings (array, optional)

## gemini_analyze_image
- prompt (string, required)
- imageUrl OR imageBase64 (required)
- mimeType (string, optional)
- model (string, optional)
- maxTokens (number, optional; must be <= limits.maxTokensPerRequest, see gemini://capabilities)

## gemini_embed_text
- text (string, required)
- model (string, optional)

## gemini_embed_text_batch
- texts (array of string, required)
- model (string, optional)

## gemini_count_tokens
- text (string, required)
- model (string, optional)

## gemini_count_tokens_batch
- texts (array of string, required)
- model (string, optional)

## gemini_list_models
- limit (number, optional; default: 200)
- pageToken (string, optional)
- filter (all|thinking|vision|grounding|json_mode, optional)
  - When listing via the API, results are sorted newest → oldest (best-effort) before returning.

## gemini_moderate_text
- text (string, required)
- model (string, optional)
- safetySettings (array, optional)
- includeRaw (boolean, optional)

## gemini_conversation_create
- conversationId (string, optional)

## gemini_conversation_list
- limit (number, optional)

## gemini_conversation_export
- conversationId (string, optional; defaults to current)

## gemini_conversation_reset
- conversationId (string, optional; defaults to current)

## gemini_code_review
- request (string, required)
- paths (array of string, optional; files/dirs relative to MCP root when filesystem.mode=repo; defaults to ['.'])
- model (string, optional)
- temperature (number, optional)
- maxTokens (number, optional; must be <= limits.maxTokensPerRequest, see gemini://capabilities)

Requires filesystem access to be enabled (filesystem.mode=repo recommended). Repo mode uses MCP roots (roots/list) as the allowlist; configure your client to send a single repo/workspace root (auto-roots can help).

## gemini_code_fix
- request (string, required)
- paths (array of string, optional; files/dirs relative to MCP root when filesystem.mode=repo; defaults to ['.'])
- apply (boolean, optional; applies the diff locally; requires filesystem.allowWrite=true)
- model (string, optional)
- temperature (number, optional)
- maxTokens (number, optional; must be <= limits.maxTokensPerRequest, see gemini://capabilities)

Requires filesystem access to be enabled (filesystem.mode=repo recommended). Repo mode uses MCP roots (roots/list) as the allowlist; configure your client to send a single repo/workspace root (auto-roots can help).

Returns JSON via structuredContent: { summary, diff, appliedFiles? }.
`;

export const HELP_EXAMPLES = `# Examples

- Use gemini_generate_text with prompt "Summarize this".
- Use gemini_generate_text_stream for long outputs (clients that support progress notifications).
- Use gemini_generate_json with prompt "Return a JSON object with keys a,b".
- Use gemini_analyze_image with prompt "Describe this photo" and imageUrl "...".
- Use gemini_list_models with limit 10.
- Use gemini_count_tokens with text "Hello world".
- Use gemini_code_review with request "Review for security issues" and paths ["src"] (requires filesystem.mode=repo + MCP roots; auto-roots to workspace if enabled).
- Use gemini_code_fix with request "Fix lint errors" and paths ["src"] (returns diff for approval).
- Read resource gemini://capabilities.
- Read resource gemini://model-capabilities.
- Read resource conversation://current.
`;
