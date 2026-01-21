function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const fenceEnd = trimmed.indexOf("\n");
  if (fenceEnd === -1) return trimmed;

  const opening = trimmed.slice(0, fenceEnd).trim();
  if (!opening.startsWith("```")) return trimmed;

  const lastFence = trimmed.lastIndexOf("```");
  if (lastFence === -1 || lastFence === 0) return trimmed;

  const inside = trimmed.slice(fenceEnd + 1, lastFence);
  return inside.trim();
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

export type JsonParseResult =
  | { ok: true; value: unknown; normalizedText: string }
  | { ok: false; error: string; normalizedText: string; snippet: string };

export function parseJsonFromText(text: string): JsonParseResult {
  const normalizedText = stripCodeFences(text);
  try {
    const value = JSON.parse(normalizedText) as unknown;
    return { ok: true, value, normalizedText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      normalizedText,
      snippet: truncate(normalizedText, 200),
    };
  }
}
