import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConversationStore } from "./conversationStore.js";

describe("ConversationStore", () => {
  let mockNowMs: () => number;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000000;
    mockNowMs = vi.fn(() => currentTime);
  });

  describe("basic operations", () => {
    it("stores and retrieves conversations", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.append("conv1", { role: "user", parts: [{ text: "Hello" }] });
      store.append("conv1", { role: "model", parts: [{ text: "Hi there!" }] });

      const contents = store.toRequestContents("conv1");
      expect(contents).toHaveLength(2);
      expect(contents[0].role).toBe("user");
      expect(contents[1].role).toBe("model");
    });

    it("returns empty array for non-existent conversation", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      const contents = store.toRequestContents("nonexistent");
      expect(contents).toEqual([]);
    });

    it("tracks current conversation", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.append("conv1", { role: "user", parts: [{ text: "Hello" }] });
      const current = store.getCurrent();
      expect(current?.id).toBe("conv1");
    });
  });

  describe("turn limiting", () => {
    it("trims oldest turns when maxTurns exceeded", () => {
      const store = new ConversationStore({
        maxTurns: 2,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.append("conv1", { role: "user", parts: [{ text: "First" }] });
      store.append("conv1", {
        role: "model",
        parts: [{ text: "First reply" }],
      });
      store.append("conv1", { role: "user", parts: [{ text: "Second" }] });

      const contents = store.toRequestContents("conv1");
      expect(contents).toHaveLength(2);
      // Should have trimmed the first message
      expect(contents[0].parts[0].text).toBe("First reply");
    });
  });

  describe("character limiting", () => {
    it("trims when total chars exceeded", () => {
      const store = new ConversationStore({
        maxTurns: 100,
        maxTotalChars: 30,
        nowMs: mockNowMs,
      });

      // Each message is ~16 chars, so 3 messages = ~48 chars > 30
      store.append("conv1", {
        role: "user",
        parts: [{ text: "Message one here" }],
      });
      store.append("conv1", {
        role: "model",
        parts: [{ text: "Reply one here" }],
      });
      store.append("conv1", {
        role: "user",
        parts: [{ text: "Message two here" }],
      });

      const contents = store.toRequestContents("conv1");
      // Should have trimmed oldest messages to fit within 30 chars
      // 3 messages = ~48 chars, 2 messages = ~32 chars, 1 message = ~16 chars
      expect(contents.length).toBeLessThanOrEqual(2);
    });

    it("truncates oversized single messages", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 20,
        nowMs: mockNowMs,
      });

      // Message longer than maxTotalChars
      store.append("conv1", {
        role: "user",
        parts: [{ text: "This is a very long message that exceeds the limit" }],
      });

      const contents = store.toRequestContents("conv1");
      expect(contents).toHaveLength(1);
      // Text should be truncated
      const textLength = contents[0].parts[0].text?.length ?? 0;
      expect(textLength).toBeLessThanOrEqual(20);
    });
  });

  describe("multiple conversations", () => {
    it("maintains separate conversations", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.append("conv1", { role: "user", parts: [{ text: "Hello conv1" }] });
      store.append("conv2", { role: "user", parts: [{ text: "Hello conv2" }] });

      const contents1 = store.toRequestContents("conv1");
      const contents2 = store.toRequestContents("conv2");

      expect(contents1[0].parts[0].text).toBe("Hello conv1");
      expect(contents2[0].parts[0].text).toBe("Hello conv2");
    });
  });

  describe("conversation management helpers", () => {
    it("create() is idempotent for a provided id and sets current", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      const created = store.create("convA");
      expect(created.id).toBe("convA");
      expect(store.getCurrentId()).toBe("convA");

      store.append("convA", { role: "user", parts: [{ text: "Hello" }] });
      const again = store.create("convA");
      expect(again.contents.length).toBe(1);
      expect(store.getCurrentId()).toBe("convA");
    });

    it("listSummaries() returns most-recent-first", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.create("conv1");
      currentTime += 1000;
      store.create("conv2");

      const summaries = store.listSummaries(10);
      expect(summaries[0]?.id).toBe("conv2");
      expect(summaries[1]?.id).toBe("conv1");
    });

    it("setCurrent() returns null for unknown ids", () => {
      const store = new ConversationStore({
        maxTurns: 10,
        maxTotalChars: 10000,
        nowMs: mockNowMs,
      });

      store.create("conv1");
      const missing = store.setCurrent("does-not-exist");
      expect(missing).toBeNull();
      expect(store.getCurrentId()).toBe("conv1");
    });
  });
});
