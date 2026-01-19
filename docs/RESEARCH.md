# Research Notes: Gemini MCP Bridge

## Online sources (checked 2026-01-17)

- Gemini API reference (generateContent, parts/inline_data, conversation history): https://ai.google.dev/api
- Gemini API authentication header x-goog-api-key: https://ai.google.dev/api
- Gemini API countTokens endpoint: https://ai.google.dev/api/tokens
- Gemini API embedContent endpoint: https://ai.google.dev/api/embeddings
- Gemini embeddings guide: https://ai.google.dev/gemini-api/docs/embeddings
- Gemini structured outputs (response_mime_type/response_json_schema): https://ai.google.dev/gemini-api/docs/structured-output
- Gemini grounding with Google Search (google_search tool): https://ai.google.dev/gemini-api/docs/google-search
- Gemini safety settings (harm categories + thresholds): https://ai.google.dev/guide/safety_setting
- Gemini API key setup (GEMINI_API_KEY / GOOGLE_API_KEY): https://ai.google.dev/gemini-api/docs/api-key

## Key findings (online docs)

- API keys can be supplied via the x-goog-api-key header; docs recommend GEMINI_API_KEY or GOOGLE_API_KEY.
- generateContent requests use a contents[] array with parts; images use inline_data with base64 + mime_type.
- countTokens is exposed as models/{model}:countTokens and returns token counts for supplied contents.
- embedContent is exposed as models/{model}:embedContent and returns embeddings for text content.
- Structured outputs use response_mime_type "application/json" and response_json_schema in generationConfig.
- Grounding uses the google_search tool and returns grounding metadata when available.
- Safety settings allow per-category thresholds to control blocking behavior.

## Local environment Gemini MCP server notes

- Tools: generate_text, analyze_image, embed_text, count_tokens, list_models, get_help.
- Features: JSON mode, grounding, safety settings, conversationId memory.

## Design implications for geminiMCPbridge

- Prefer header-based API key usage to avoid leaking keys in URLs.
- Implement tools that map directly to generateContent, countTokens, listModels, and embedContent.
- Provide JSON mode and grounding flags on gemini_generate_text to align with Gemini MCP.
- Add discoverability resources (capabilities, models, help) for onboarding.
- Enforce local rate limits and daily budgets to prevent runaway costs.
- Cap image sizes and allowed MIME types for safety and stability.

## AI synthesis (local MCPs)

- Gemini MCP help emphasized the core tool surface (generate_text, analyze_image, embed_text, count_tokens, list_models, get_help) plus JSON mode, grounding, safety settings, and conversationId memory.
- Claude MCP review highlighted risks around cost management, safety filters, image size controls, and the need for robust error handling and rate limiting.
