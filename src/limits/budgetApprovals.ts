import fs from "node:fs";
import path from "node:path";
import { expandHome } from "../utils/paths.js";

type BudgetApprovalEntry = {
  tokens: number;
  increments: number;
  updatedAt: string;
};

type BudgetApprovalFile = {
  version: 1;
  days: Record<string, BudgetApprovalEntry>;
};

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    return;
  }
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Ignore chmod failures on unsupported platforms.
  }
}

function readApprovalFile(filePath: string): BudgetApprovalFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, days: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as BudgetApprovalFile;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      parsed.days &&
      typeof parsed.days === "object"
    ) {
      return parsed;
    }
  } catch {
    // Ignore parse errors and reset to empty approvals.
  }
  return { version: 1, days: {} };
}

function writeApprovalFile(filePath: string, data: BudgetApprovalFile): void {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const payload = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(filePath, payload, "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures on unsupported platforms.
  }
}

export function readApprovedTokens(filePath: string, dayUtc: string): number {
  const resolved = expandHome(filePath);
  const data = readApprovalFile(resolved);
  const entry = data.days[dayUtc];
  if (!entry) return 0;
  return Number.isFinite(entry.tokens) ? entry.tokens : 0;
}

export function approveBudgetIncrement(
  filePath: string,
  dayUtc: string,
  incrementTokens: number,
): BudgetApprovalEntry {
  const resolved = expandHome(filePath);
  const data = readApprovalFile(resolved);
  const existing = data.days[dayUtc];
  const currentTokens = existing?.tokens ?? 0;
  const currentIncrements = existing?.increments ?? 0;
  const nextTokens = currentTokens + incrementTokens;
  const nextIncrements = currentIncrements + 1;
  const updatedAt = new Date().toISOString();
  const entry: BudgetApprovalEntry = {
    tokens: nextTokens,
    increments: nextIncrements,
    updatedAt,
  };
  data.days[dayUtc] = entry;
  writeApprovalFile(resolved, data);
  return entry;
}
