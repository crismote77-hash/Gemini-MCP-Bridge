import { randomUUID } from "node:crypto";

export type ContentPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export type ContentMessage = {
  role: "user" | "model";
  parts: ContentPart[];
};

type ConversationState = {
  id: string;
  contents: ContentMessage[];
  updatedAt: string;
};

export type ConversationSummary = {
  id: string;
  updatedAt: string;
  turns: number;
  totalChars: number;
};

export class ConversationStore {
  private readonly maxTurns: number;
  private readonly maxTotalChars: number;
  private readonly conversations = new Map<string, ConversationState>();
  private lastActiveId: string | null = null;
  private readonly nowMs: () => number;

  constructor(opts: {
    maxTurns: number;
    maxTotalChars: number;
    nowMs?: () => number;
  }) {
    this.maxTurns = opts.maxTurns;
    this.maxTotalChars = opts.maxTotalChars;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  get(id: string): ConversationState | undefined {
    return this.conversations.get(id);
  }

  create(id?: string): ConversationState {
    const provided = id?.trim();
    if (provided) {
      const existing = this.conversations.get(provided);
      if (existing) {
        this.lastActiveId = provided;
        return existing;
      }
      const now = new Date(this.nowMs()).toISOString();
      const state = { id: provided, contents: [], updatedAt: now };
      this.conversations.set(provided, state);
      this.lastActiveId = provided;
      return state;
    }

    let generated = randomUUID();
    while (this.conversations.has(generated)) {
      generated = randomUUID();
    }
    const now = new Date(this.nowMs()).toISOString();
    const state = { id: generated, contents: [], updatedAt: now };
    this.conversations.set(generated, state);
    this.lastActiveId = generated;
    return state;
  }

  listSummaries(limit = 50): ConversationSummary[] {
    const summaries = Array.from(this.conversations.values()).map((state) => ({
      id: state.id,
      updatedAt: state.updatedAt,
      turns: state.contents.length,
      totalChars: this.totalChars(state.contents),
    }));
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries.slice(0, Math.max(0, Math.trunc(limit)));
  }

  getCurrentId(): string | null {
    return this.lastActiveId;
  }

  setCurrent(id: string): ConversationState | null {
    const trimmed = id.trim();
    const existing = this.conversations.get(trimmed) ?? null;
    if (existing) this.lastActiveId = trimmed;
    return existing;
  }

  reset(id: string): void {
    this.conversations.delete(id);
    if (this.lastActiveId === id) this.lastActiveId = null;
  }

  append(id: string, message: ContentMessage): ConversationState {
    const now = new Date(this.nowMs()).toISOString();
    const existing = this.conversations.get(id);
    const contents = existing ? [...existing.contents, message] : [message];
    const trimmed = this.trim(contents);
    const state = { id, contents: trimmed, updatedAt: now };
    this.conversations.set(id, state);
    this.lastActiveId = id;
    return state;
  }

  getCurrent(): ConversationState | null {
    if (!this.lastActiveId) return null;
    return this.conversations.get(this.lastActiveId) ?? null;
  }

  toRequestContents(id: string): ContentMessage[] {
    return this.conversations.get(id)?.contents ?? [];
  }

  private trim(contents: ContentMessage[]): ContentMessage[] {
    let result = [...contents];
    while (result.length > this.maxTurns) {
      result.shift();
    }
    while (this.totalChars(result) > this.maxTotalChars && result.length > 1) {
      result.shift();
    }
    // Handle edge case: single oversized message
    if (result.length === 1 && this.totalChars(result) > this.maxTotalChars) {
      result = [this.truncateMessage(result[0], this.maxTotalChars)];
    }
    return result;
  }

  private truncateMessage(
    message: ContentMessage,
    maxChars: number,
  ): ContentMessage {
    let remainingChars = maxChars;
    const truncatedParts: ContentPart[] = [];
    const marker = "... [truncated]";

    for (const part of message.parts) {
      if (remainingChars <= 0) break;

      if (part.text) {
        if (part.text.length <= remainingChars) {
          truncatedParts.push(part);
          remainingChars -= part.text.length;
        } else {
          // Truncate text safely and add marker if it fits
          if (remainingChars > marker.length) {
            const sliceLen = remainingChars - marker.length;
            const truncatedText = part.text.slice(0, sliceLen) + marker;
            truncatedParts.push({ text: truncatedText });
          } else {
            truncatedParts.push({ text: part.text.slice(0, remainingChars) });
          }
          remainingChars = 0;
        }
      } else if (part.inlineData?.data) {
        // For binary data, either include it fully or skip it
        if (part.inlineData.data.length <= remainingChars) {
          truncatedParts.push(part);
          remainingChars -= part.inlineData.data.length;
        }
        // Otherwise skip this part entirely (don't truncate binary data)
      }
    }

    return { role: message.role, parts: truncatedParts };
  }

  private totalChars(contents: ContentMessage[]): number {
    return contents.reduce((sum, msg) => sum + this.messageChars(msg), 0);
  }

  private messageChars(message: ContentMessage): number {
    return message.parts.reduce((sum, part) => {
      if (part.text) return sum + part.text.length;
      if (part.inlineData?.data) return sum + part.inlineData.data.length;
      return sum;
    }, 0);
  }
}
