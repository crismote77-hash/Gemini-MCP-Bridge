export class BudgetError extends Error {
  name = "BudgetError";
}

export class BudgetApprovalRequiredError extends BudgetError {
  name = "BudgetApprovalRequiredError";
  incrementTokens: number;
  usedTokens: number;
  maxTokens: number;

  constructor(opts: {
    incrementTokens: number;
    usedTokens: number;
    maxTokens: number;
  }) {
    super(
      `Token budget exceeded (${opts.usedTokens}/${opts.maxTokens}). Approval required for +${opts.incrementTokens}.`,
    );
    this.incrementTokens = opts.incrementTokens;
    this.usedTokens = opts.usedTokens;
    this.maxTokens = opts.maxTokens;
  }
}

function utcDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

import type { SharedLimitStore } from "./sharedStore.js";
import {
  approveBudgetIncrement,
  readApprovedTokens,
} from "./budgetApprovals.js";

function parseNonNegativeNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export type BudgetReservation = {
  tokens: number;
};

export class DailyTokenBudget {
  private readonly baseMaxTokensPerDay: number;
  private readonly approvalPolicy: "auto" | "prompt" | "never";
  private readonly approvalPath?: string;
  private readonly incrementTokens: number;
  private readonly nowMs: () => number;
  private currentDay: string;
  private usedTokens = 0;
  private approvedTokens = 0;
  private usedCostNanoUsd = 0;
  private hasCost = false;
  private byTool: Record<
    string,
    { tokens: number; calls: number; costNanoUsd: number }
  > = {};
  private readonly sharedStore?: SharedLimitStore;
  private static readonly SHARED_TTL_SECONDS = 172800;
  private static readonly RESERVE_SCRIPT = `
    local totalKey = KEYS[1]
    local reserve = tonumber(ARGV[1])
    local maxTokens = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])

    local used = tonumber(redis.call('get', totalKey) or '0')
    if (used + reserve) > maxTokens then
      return {0, used}
    end
    local next = redis.call('incrby', totalKey, reserve)
    redis.call('expire', totalKey, ttl)
    return {1, next}
  `;

  constructor(opts: {
    maxTokensPerDay: number;
    nowMs?: () => number;
    sharedStore?: SharedLimitStore;
    approvalPolicy?: "auto" | "prompt" | "never";
    approvalPath?: string;
    incrementTokens?: number;
  }) {
    this.baseMaxTokensPerDay = opts.maxTokensPerDay;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.currentDay = utcDayKey(this.nowMs());
    this.sharedStore = opts.sharedStore;
    this.approvalPolicy = opts.approvalPolicy ?? "prompt";
    this.approvalPath = opts.approvalPath;
    this.incrementTokens = Math.max(0, Math.trunc(opts.incrementTokens ?? 0));
  }

  async getUsage(): Promise<{
    dayUtc: string;
    usedTokens: number;
    maxTokens: number;
    baseMaxTokens: number;
    approvedTokens: number;
    requestCount: number;
    estimatedCostUsd?: number;
    byTool: Record<
      string,
      { tokens: number; calls: number; estimatedCostUsd?: number }
    >;
  }> {
    if (this.sharedStore) {
      return this.getSharedUsage();
    }
    this.rollIfNeeded();
    const maxTokens = this.getEffectiveMaxTokens(this.currentDay);
    const requestCount = Object.values(this.byTool).reduce(
      (sum, entry) => sum + entry.calls,
      0,
    );
    const estimatedCostUsd = this.hasCost
      ? this.usedCostNanoUsd / 1_000_000_000
      : undefined;
    const byTool: Record<
      string,
      { tokens: number; calls: number; estimatedCostUsd?: number }
    > = {};
    for (const [toolName, entry] of Object.entries(this.byTool)) {
      byTool[toolName] = {
        tokens: entry.tokens,
        calls: entry.calls,
        ...(this.hasCost
          ? { estimatedCostUsd: entry.costNanoUsd / 1_000_000_000 }
          : {}),
      };
    }
    return {
      dayUtc: this.currentDay,
      usedTokens: this.usedTokens,
      maxTokens,
      baseMaxTokens: this.baseMaxTokensPerDay,
      approvedTokens: this.approvedTokens,
      requestCount,
      ...(this.hasCost ? { estimatedCostUsd } : {}),
      byTool,
    };
  }

  async checkOrThrow(): Promise<void> {
    if (this.sharedStore) {
      const dayKey = utcDayKey(this.nowMs());
      const usedTokens = await this.getSharedTotal();
      const maxTokens = this.getEffectiveMaxTokens(dayKey);
      if (usedTokens >= maxTokens) {
        if (this.maybeAutoApprove(dayKey)) {
          const updatedMax = this.getEffectiveMaxTokens(dayKey);
          if (usedTokens < updatedMax) return;
        }
        await this.handleOverBudget(usedTokens, maxTokens);
      }
      return;
    }
    this.rollIfNeeded();
    const maxTokens = this.getEffectiveMaxTokens(this.currentDay);
    if (this.usedTokens >= maxTokens) {
      if (this.maybeAutoApprove(this.currentDay)) {
        const updatedMax = this.getEffectiveMaxTokens(this.currentDay);
        if (this.usedTokens < updatedMax) return;
      }
      await this.handleOverBudget(this.usedTokens, maxTokens);
    }
  }

  async reserve(tokens: number): Promise<BudgetReservation> {
    const normalized = Math.max(0, Math.trunc(tokens));
    if (normalized === 0) {
      await this.checkOrThrow();
      return { tokens: 0 };
    }
    if (this.sharedStore) {
      const dayKey = utcDayKey(this.nowMs());
      let maxTokens = this.getEffectiveMaxTokens(dayKey);
      try {
        await this.reserveShared(normalized, maxTokens);
      } catch (error) {
        if (error instanceof BudgetError && this.maybeAutoApprove(dayKey)) {
          maxTokens = this.getEffectiveMaxTokens(dayKey);
          await this.reserveShared(normalized, maxTokens);
        } else if (error instanceof BudgetError) {
          await this.handleOverBudget(await this.getSharedTotal(), maxTokens);
        } else {
          throw error;
        }
      }
      return { tokens: normalized };
    }
    this.rollIfNeeded();
    let maxTokens = this.getEffectiveMaxTokens(this.currentDay);
    if (this.usedTokens + normalized > maxTokens) {
      if (this.maybeAutoApprove(this.currentDay)) {
        maxTokens = this.getEffectiveMaxTokens(this.currentDay);
      }
      if (this.usedTokens + normalized > maxTokens) {
        await this.handleOverBudget(this.usedTokens, maxTokens);
      }
    }
    this.usedTokens += normalized;
    return { tokens: normalized };
  }

  async release(reservation?: BudgetReservation): Promise<void> {
    if (!reservation) return;
    const normalized = Math.max(0, Math.trunc(reservation.tokens));
    if (normalized === 0) return;
    if (this.sharedStore) {
      await this.releaseShared(normalized);
      return;
    }
    this.rollIfNeeded();
    this.usedTokens = Math.max(0, this.usedTokens - normalized);
  }

  async add(tokens: number): Promise<void> {
    await this.recordUsage("unknown", tokens);
  }

  async recordUsage(
    toolName: string,
    tokens: number,
    costNanoUsd?: number,
  ): Promise<void> {
    await this.commit(toolName, tokens, costNanoUsd);
  }

  async commit(
    toolName: string,
    tokens: number,
    costNanoUsd?: number,
    reservation?: BudgetReservation,
  ): Promise<void> {
    if (this.sharedStore) {
      await this.commitSharedUsage(
        toolName,
        tokens,
        costNanoUsd,
        reservation?.tokens,
      );
      return;
    }
    this.rollIfNeeded();
    const normalizedTokens = Math.max(0, tokens);
    const reserved = Math.max(0, Math.trunc(reservation?.tokens ?? 0));
    this.usedTokens = Math.max(
      0,
      this.usedTokens + normalizedTokens - reserved,
    );
    const existing = this.byTool[toolName] ?? {
      tokens: 0,
      calls: 0,
      costNanoUsd: 0,
    };
    this.byTool[toolName] = {
      tokens: existing.tokens + normalizedTokens,
      calls: existing.calls + 1,
      costNanoUsd: existing.costNanoUsd,
    };

    if (typeof costNanoUsd === "number" && Number.isFinite(costNanoUsd)) {
      const normalizedCost = Math.max(0, Math.trunc(costNanoUsd));
      this.usedCostNanoUsd += normalizedCost;
      this.byTool[toolName].costNanoUsd += normalizedCost;
      this.hasCost = true;
    }
  }

  private rollIfNeeded(): void {
    const day = utcDayKey(this.nowMs());
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.usedTokens = 0;
      this.approvedTokens = 0;
      this.usedCostNanoUsd = 0;
      this.hasCost = false;
      this.byTool = {};
    }
  }

  private getEffectiveMaxTokens(dayKey: string): number {
    if (this.approvalPath) {
      this.approvedTokens = readApprovedTokens(this.approvalPath, dayKey);
    } else {
      this.approvedTokens = 0;
    }
    return this.baseMaxTokensPerDay + this.approvedTokens;
  }

  private async handleOverBudget(
    usedTokens: number,
    maxTokens: number,
  ): Promise<never> {
    if (this.approvalPolicy === "prompt" && this.incrementTokens > 0) {
      throw new BudgetApprovalRequiredError({
        incrementTokens: this.incrementTokens,
        usedTokens,
        maxTokens,
      });
    }
    throw new BudgetError(
      `Daily token budget exceeded (${usedTokens}/${maxTokens}).`,
    );
  }

  private maybeAutoApprove(dayKey: string): boolean {
    if (
      this.approvalPolicy !== "auto" ||
      this.incrementTokens <= 0 ||
      !this.approvalPath
    ) {
      return false;
    }
    approveBudgetIncrement(this.approvalPath, dayKey, this.incrementTokens);
    return true;
  }

  private async reserveShared(
    tokens: number,
    maxTokens: number,
  ): Promise<void> {
    if (!this.sharedStore) return;
    const dayKey = utcDayKey(this.nowMs());
    const prefix = `${this.sharedStore.keyPrefix}:budget:${dayKey}`;
    const totalKey = `${prefix}:total`;
    const result = (await this.sharedStore.client.eval(
      DailyTokenBudget.RESERVE_SCRIPT,
      {
        keys: [totalKey],
        arguments: [
          String(tokens),
          String(maxTokens),
          String(DailyTokenBudget.SHARED_TTL_SECONDS),
        ],
      },
    )) as unknown;
    const [allowed, usedTokens] = Array.isArray(result)
      ? (result as [number, number])
      : [0, 0];
    if (!allowed) {
      throw new BudgetError(
        `Daily token budget exceeded (${usedTokens}/${maxTokens}).`,
      );
    }
  }

  private async releaseShared(tokens: number): Promise<void> {
    if (!this.sharedStore) return;
    const dayKey = utcDayKey(this.nowMs());
    const prefix = `${this.sharedStore.keyPrefix}:budget:${dayKey}`;
    const totalKey = `${prefix}:total`;
    await this.sharedStore.client.incrBy(totalKey, -tokens);
    await this.sharedStore.client.expire(
      totalKey,
      DailyTokenBudget.SHARED_TTL_SECONDS,
    );
  }

  private async commitSharedUsage(
    toolName: string,
    tokens: number,
    costNanoUsd?: number,
    reservedTokens?: number,
  ): Promise<void> {
    if (!this.sharedStore) return;
    const dayKey = utcDayKey(this.nowMs());
    const normalizedTokens = Math.max(0, tokens);
    const reserved = Math.max(0, Math.trunc(reservedTokens ?? 0));
    const delta = normalizedTokens - reserved;
    const prefix = `${this.sharedStore.keyPrefix}:budget:${dayKey}`;
    const totalKey = `${prefix}:total`;
    const toolsKey = `${prefix}:tools`;
    const tokenKey = `${prefix}:tool:${toolName}:tokens`;
    const callsKey = `${prefix}:tool:${toolName}:calls`;
    const costTotalKey = `${prefix}:costNanoUsd`;
    const costKey = `${prefix}:tool:${toolName}:costNanoUsd`;

    const txn = this.sharedStore.client.multi();
    txn.incrBy(totalKey, delta);
    txn.incrBy(tokenKey, normalizedTokens);
    txn.incrBy(callsKey, 1);
    txn.sAdd(toolsKey, toolName);
    txn.expire(totalKey, DailyTokenBudget.SHARED_TTL_SECONDS);
    txn.expire(tokenKey, DailyTokenBudget.SHARED_TTL_SECONDS);
    txn.expire(callsKey, DailyTokenBudget.SHARED_TTL_SECONDS);
    txn.expire(toolsKey, DailyTokenBudget.SHARED_TTL_SECONDS);

    if (typeof costNanoUsd === "number" && Number.isFinite(costNanoUsd)) {
      const normalizedCost = Math.max(0, Math.trunc(costNanoUsd));
      txn.incrBy(costTotalKey, normalizedCost);
      txn.incrBy(costKey, normalizedCost);
      txn.expire(costTotalKey, DailyTokenBudget.SHARED_TTL_SECONDS);
      txn.expire(costKey, DailyTokenBudget.SHARED_TTL_SECONDS);
    }

    await txn.exec();
  }

  private async getSharedTotal(): Promise<number> {
    if (!this.sharedStore) return 0;
    const dayKey = utcDayKey(this.nowMs());
    const prefix = `${this.sharedStore.keyPrefix}:budget:${dayKey}`;
    const totalKey = `${prefix}:total`;
    const usedTokensRaw = await this.sharedStore.client.get(totalKey);
    return parseNonNegativeNumber(usedTokensRaw);
  }

  private async getSharedUsage(): Promise<{
    dayUtc: string;
    usedTokens: number;
    maxTokens: number;
    baseMaxTokens: number;
    approvedTokens: number;
    requestCount: number;
    estimatedCostUsd?: number;
    byTool: Record<
      string,
      { tokens: number; calls: number; estimatedCostUsd?: number }
    >;
  }> {
    if (!this.sharedStore) {
      return {
        dayUtc: this.currentDay,
        usedTokens: 0,
        maxTokens: this.getEffectiveMaxTokens(this.currentDay),
        baseMaxTokens: this.baseMaxTokensPerDay,
        approvedTokens: this.approvedTokens,
        requestCount: 0,
        byTool: {},
      };
    }

    const dayKey = utcDayKey(this.nowMs());
    const prefix = `${this.sharedStore.keyPrefix}:budget:${dayKey}`;
    const totalKey = `${prefix}:total`;
    const toolsKey = `${prefix}:tools`;
    const costTotalKey = `${prefix}:costNanoUsd`;
    const usedTokensRaw = await this.sharedStore.client.get(totalKey);
    const usedTokens = parseNonNegativeNumber(usedTokensRaw);
    const costNanoUsdRaw = await this.sharedStore.client.get(costTotalKey);
    const costNanoUsd = parseNonNegativeNumber(costNanoUsdRaw);
    const hasCost = costNanoUsdRaw !== null;

    const toolNames = await this.sharedStore.client.sMembers(toolsKey);
    const byTool: Record<
      string,
      { tokens: number; calls: number; estimatedCostUsd?: number }
    > = {};
    let requestCount = 0;

    for (const tool of toolNames) {
      const tokenKey = `${prefix}:tool:${tool}:tokens`;
      const callsKey = `${prefix}:tool:${tool}:calls`;
      const costKey = `${prefix}:tool:${tool}:costNanoUsd`;
      const tokensRaw = await this.sharedStore.client.get(tokenKey);
      const callsRaw = await this.sharedStore.client.get(callsKey);
      const tokens = parseNonNegativeNumber(tokensRaw);
      const calls = parseNonNegativeNumber(callsRaw);
      const toolCostRaw = hasCost
        ? await this.sharedStore.client.get(costKey)
        : null;
      const toolCost = parseNonNegativeNumber(toolCostRaw);
      byTool[tool] = {
        tokens,
        calls,
        ...(toolCostRaw !== null
          ? { estimatedCostUsd: toolCost / 1_000_000_000 }
          : {}),
      };
      requestCount += calls;
    }

    const maxTokens = this.getEffectiveMaxTokens(dayKey);
    return {
      dayUtc: dayKey,
      usedTokens,
      maxTokens,
      baseMaxTokens: this.baseMaxTokensPerDay,
      approvedTokens: this.approvedTokens,
      requestCount,
      ...(hasCost ? { estimatedCostUsd: costNanoUsd / 1_000_000_000 } : {}),
      byTool,
    };
  }
}
