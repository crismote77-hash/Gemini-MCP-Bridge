import { isRecord } from "./typeGuards.js";

export type GeminiUsage = {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
};

export type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export type GeminiContent = {
  role?: string;
  parts?: GeminiPart[];
};

export type GeminiCandidate = {
  content?: GeminiContent;
  finishReason?: string;
  safetyRatings?: unknown[];
};

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
};

function isGeminiResponse(value: unknown): value is GeminiResponse {
  if (!isRecord(value)) return false;
  // candidates is optional, but if present must be an array
  if ("candidates" in value && !Array.isArray(value.candidates)) return false;
  // usageMetadata is optional, but if present must be an object
  if ("usageMetadata" in value && !isRecord(value.usageMetadata)) return false;
  return true;
}

export function extractText(response: unknown): string {
  if (!isGeminiResponse(response)) return "";

  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const content = candidate.content;
    if (!isRecord(content)) continue;
    const parts = content.parts;
    if (!Array.isArray(parts)) continue;

    const text = parts
      .map((part: unknown) => {
        if (isRecord(part) && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter((text: string) => text.length > 0)
      .join("");

    if (text) return text;
  }

  return "";
}

export function extractUsage(response: unknown): GeminiUsage {
  const defaultUsage: GeminiUsage = {
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
  };

  if (!isGeminiResponse(response)) return defaultUsage;

  const usage = response.usageMetadata;
  if (!isRecord(usage)) return defaultUsage;

  const prompt =
    typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0;
  const candidates =
    typeof usage.candidatesTokenCount === "number"
      ? usage.candidatesTokenCount
      : 0;
  const total =
    typeof usage.totalTokenCount === "number"
      ? usage.totalTokenCount
      : prompt + candidates;

  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    candidatesTokens: Number.isFinite(candidates) ? candidates : 0,
    totalTokens: Number.isFinite(total) ? total : 0,
  };
}

export function extractPromptBlockReason(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  const promptFeedback = response.promptFeedback;
  if (!isRecord(promptFeedback)) return undefined;

  const blockReason =
    typeof promptFeedback.blockReason === "string"
      ? promptFeedback.blockReason
      : undefined;
  const blockReasonMessage =
    typeof promptFeedback.blockReasonMessage === "string"
      ? promptFeedback.blockReasonMessage
      : undefined;

  if (blockReason && blockReasonMessage) {
    return `${blockReason}: ${blockReasonMessage}`;
  }
  return blockReason ?? blockReasonMessage;
}

export function extractFirstCandidateFinishReason(
  response: unknown,
): string | undefined {
  if (!isRecord(response)) return undefined;
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const firstCandidate = candidates[0];
  if (!isRecord(firstCandidate)) return undefined;
  const finishReason = firstCandidate.finishReason;
  return typeof finishReason === "string" ? finishReason : undefined;
}
