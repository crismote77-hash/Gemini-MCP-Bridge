import { describe, expect, it, vi, beforeEach } from "vitest";
import { DailyTokenBudget, BudgetError } from "./dailyTokenBudget.js";

describe("DailyTokenBudget", () => {
  let mockNowMs: () => number;
  let currentTime: number;

  beforeEach(() => {
    // Set to a fixed date: 2025-01-15 12:00:00 UTC
    currentTime = new Date("2025-01-15T12:00:00Z").getTime();
    mockNowMs = vi.fn(() => currentTime);
  });

  describe("basic operations", () => {
    it("allows usage under the limit", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 1000,
        nowMs: mockNowMs,
      });

      await budget.commit("test_tool", 500);
      const usage = await budget.getUsage();
      expect(usage.usedTokens).toBe(500);
      expect(usage.maxTokens).toBe(1000);
    });

    it("throws BudgetError when limit exceeded", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 100,
        nowMs: mockNowMs,
      });

      await budget.commit("test_tool", 100);
      await expect(budget.checkOrThrow()).rejects.toThrow(BudgetError);
      await expect(budget.checkOrThrow()).rejects.toThrow(
        "Daily token budget exceeded (100/100).",
      );
    });

    it("tracks usage by tool", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 1000,
        nowMs: mockNowMs,
      });

      await budget.commit("tool_a", 100);
      await budget.commit("tool_a", 50);
      await budget.commit("tool_b", 200);

      const usage = await budget.getUsage();
      expect(usage.byTool.tool_a).toEqual({ tokens: 150, calls: 2 });
      expect(usage.byTool.tool_b).toEqual({ tokens: 200, calls: 1 });
    });
  });

  describe("day rollover", () => {
    it("resets usage on new UTC day", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 1000,
        nowMs: mockNowMs,
      });

      await budget.commit("test_tool", 500);
      expect((await budget.getUsage()).usedTokens).toBe(500);

      // Advance to next day
      currentTime = new Date("2025-01-16T00:00:01Z").getTime();

      const usage = await budget.getUsage();
      expect(usage.usedTokens).toBe(0);
      expect(usage.dayUtc).toBe("2025-01-16");
    });
  });

  describe("reservations", () => {
    it("reserves tokens for pending operations", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 100,
        nowMs: mockNowMs,
      });

      const reservation = await budget.reserve(60);
      expect(reservation.tokens).toBe(60);

      // Should fail because 60 + 50 > 100
      await expect(budget.reserve(50)).rejects.toThrow(BudgetError);
    });

    it("releases reservation on error", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 100,
        nowMs: mockNowMs,
      });

      const reservation = await budget.reserve(60);
      await budget.release(reservation);

      // Should now allow full reservation again
      await expect(budget.reserve(60)).resolves.toBeDefined();
    });

    it("commits usage accounting for reservation", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 100,
        nowMs: mockNowMs,
      });

      const reservation = await budget.reserve(50);
      // Actual usage was 40, reserved 50
      await budget.commit("test_tool", 40, undefined, reservation);

      const usage = await budget.getUsage();
      // Should be 40 (actual) not 50 (reserved) because commit adjusts
      expect(usage.usedTokens).toBe(40);
    });

    it("handles zero-token reservations", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 100,
        nowMs: mockNowMs,
      });

      const reservation = await budget.reserve(0);
      expect(reservation.tokens).toBe(0);

      // Should still be able to use full budget
      await budget.commit("test_tool", 100);
      expect((await budget.getUsage()).usedTokens).toBe(100);
    });
  });

  describe("cost tracking", () => {
    it("tracks cost when provided", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 1000,
        nowMs: mockNowMs,
      });

      // Cost in nano-USD (1000 nano = 0.000001 USD)
      await budget.commit("test_tool", 100, 1_000_000_000); // $1

      const usage = await budget.getUsage();
      expect(usage.estimatedCostUsd).toBe(1);
      expect(usage.byTool.test_tool.estimatedCostUsd).toBe(1);
    });

    it("omits cost when not provided", async () => {
      const budget = new DailyTokenBudget({
        maxTokensPerDay: 1000,
        nowMs: mockNowMs,
      });

      await budget.commit("test_tool", 100);

      const usage = await budget.getUsage();
      expect(usage.estimatedCostUsd).toBeUndefined();
    });
  });
});
