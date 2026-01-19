export function estimateTokenReserve(input: string, maxOutputTokens: number): number {
  const inputTokens = Math.max(0, Math.ceil(input.length / 4));
  return Math.max(0, maxOutputTokens + inputTokens);
}
