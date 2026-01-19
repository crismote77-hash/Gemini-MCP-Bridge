export const HELP_USAGE = `# Gemini MCP Bridge Help

## Quick Start
- Use gemini_generate_text for core text generation.
- Use gemini_analyze_image for multimodal prompts.
- Use gemini_embed_text for embeddings.
- Use gemini_count_tokens for token estimates.
- Use gemini_list_models for available models.
- Use gemini_get_help for built-in help.

## Authentication & Backend
- Default backend is the Gemini Developer API. Use an API key: GEMINI_API_KEY=... (or GOOGLE_API_KEY).
- To use gcloud/ADC (subscription) credentials, set GEMINI_MCP_BACKEND=vertex and configure GEMINI_MCP_VERTEX_PROJECT + GEMINI_MCP_VERTEX_LOCATION.
- In GEMINI_MCP_AUTH_MODE=auto, the bridge can retry with an API key if OAuth/ADC fails (and will warn on modality change).

## Discoverability
- Read gemini://capabilities for server features.
- Read gemini://models for configured defaults.
- Read gemini://help/parameters for tool inputs.
`;

export const HELP_PARAMETERS = `# Parameters Reference

## gemini_generate_text
- prompt (string, required)
- model (string, optional)
- temperature, topK, topP, maxTokens (optional)
- systemInstruction (string, optional)
- jsonMode (boolean, optional)
- jsonSchema (object, optional)
- grounding (boolean, optional)
- conversationId (string, optional)
- safetySettings (array, optional)

## gemini_analyze_image
- prompt (string, required)
- imageUrl OR imageBase64 (required)
- mimeType (string, optional)
- model (string, optional)
- maxTokens (number, optional)

## gemini_embed_text
- text (string, required)
- model (string, optional)

## gemini_count_tokens
- text (string, required)
- model (string, optional)

## gemini_list_models
- limit (number, optional; default: 200)
- pageToken (string, optional)
- filter (all|thinking|vision|grounding|json_mode, optional)
  - When listing via the API, results are sorted newest → oldest (best-effort) before returning.
`;

export const HELP_EXAMPLES = `# Examples

- Use gemini_generate_text with prompt "Summarize this".
- Use gemini_analyze_image with prompt "Describe this photo" and imageUrl "...".
- Use gemini_list_models with limit 10.
- Use gemini_count_tokens with text "Hello world".
- Read resource gemini://capabilities.
`;
