export type TextBlock = { type: "text"; text: string };

export function textBlock(text: string): TextBlock {
  return { type: "text", text };
}
