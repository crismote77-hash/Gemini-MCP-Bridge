import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveBudgetIncrement,
  readApprovedTokens,
} from "./budgetApprovals.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-mcp-budget-"));
}

describe("budget approvals", () => {
  it("returns 0 when no approval file exists", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "budget-approvals.json");
    expect(readApprovedTokens(filePath, "2025-01-15")).toBe(0);
  });

  it("increments approved tokens for a day", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "budget-approvals.json");
    const entry = approveBudgetIncrement(filePath, "2025-01-15", 200000);
    expect(entry.tokens).toBe(200000);
    expect(entry.increments).toBe(1);
    expect(readApprovedTokens(filePath, "2025-01-15")).toBe(200000);
    const entry2 = approveBudgetIncrement(filePath, "2025-01-15", 200000);
    expect(entry2.tokens).toBe(400000);
    expect(entry2.increments).toBe(2);
  });
});
