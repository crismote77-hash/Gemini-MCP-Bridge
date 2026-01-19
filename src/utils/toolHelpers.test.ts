import { describe, it, expect, vi, beforeEach } from "vitest";
import { withBudgetReservation, validateInputSize } from "./toolHelpers.js";
import type { ToolDependencies } from "./toolHelpers.js";
import type { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { RateLimiter } from "../limits/rateLimiter.js";

describe("withBudgetReservation", () => {
  let mockBudget: Pick<DailyTokenBudget, "reserve" | "release" | "commit">;
  let releaseMock: ReturnType<typeof vi.fn>;
  let mockDeps: ToolDependencies;

  beforeEach(() => {
    releaseMock = vi.fn().mockResolvedValue(undefined);
    mockBudget = {
      reserve: vi.fn().mockResolvedValue({ tokens: 100 }),
      release: releaseMock,
      commit: vi.fn().mockResolvedValue(undefined),
    };
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mockDeps = {
      config: {} as unknown as BridgeConfig,
      rateLimiter: { checkOrThrow: vi.fn() } as unknown as RateLimiter,
      dailyBudget: mockBudget as unknown as DailyTokenBudget,
      logger: mockLogger,
    } as ToolDependencies;
  });

  it("should reserve budget and execute the function", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");
    const result = await withBudgetReservation(mockDeps, 100, mockFn);

    expect(mockBudget.reserve).toHaveBeenCalledWith(100);
    expect(mockFn).toHaveBeenCalledWith({ tokens: 100 });
    expect(result).toBe("success");
    expect(mockBudget.release).not.toHaveBeenCalled(); // Should not release on success (caller commits)
  });

  it("should release budget if the function throws", async () => {
    const error = new Error("Operation failed");
    const mockFn = vi.fn().mockRejectedValue(error);

    await expect(withBudgetReservation(mockDeps, 100, mockFn)).rejects.toThrow(
      error,
    );

    expect(mockBudget.reserve).toHaveBeenCalledWith(100);
    expect(mockBudget.release).toHaveBeenCalledWith({ tokens: 100 });
  });

  it("should handle release failure gracefully", async () => {
    const error = new Error("Operation failed");
    const mockFn = vi.fn().mockRejectedValue(error);
    releaseMock.mockRejectedValue(new Error("Release failed"));

    await expect(withBudgetReservation(mockDeps, 100, mockFn)).rejects.toThrow(
      error,
    );

    expect(mockBudget.release).toHaveBeenCalled();
    expect(mockDeps.logger.warn).toHaveBeenCalledWith(
      "Failed to release budget reservation",
      expect.objectContaining({ error: "Release failed" }),
    );
  });
});

describe("validateInputSize", () => {
  it("returns null when input is within limits", () => {
    expect(validateInputSize("hello", 5)).toBeNull();
  });

  it("accounts for extraChars in the total size", () => {
    const result = validateInputSize("hello", 5, "input", 1);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("Max input is 5 characters");
  });
});
