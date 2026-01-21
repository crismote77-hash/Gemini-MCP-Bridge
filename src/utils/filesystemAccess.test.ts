import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { RootsExtra } from "./filesystemAccess.js";
import {
  applyUnifiedDiffToFilesystem,
  collectReadableTextFiles,
  parseUnifiedDiff,
} from "./filesystemAccess.js";

function createTempRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-mcp-bridge-"));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function createExtraWithRoot(rootPath: string): RootsExtra {
  return {
    requestId: "test",
    signal: new AbortController().signal,
    sendNotification: vi.fn(async () => undefined),
    sendRequest: vi.fn(async () => ({
      roots: [{ uri: pathToFileURL(rootPath).toString() }],
    })),
  } as unknown as RootsExtra;
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function baseConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    filesystem: {
      mode: "repo",
      allowWrite: false,
      allowSystem: false,
      followSymlinks: true,
      maxFiles: 25,
      maxFileBytes: 200_000,
      maxTotalBytes: 2_000_000,
      allowedExtensions: [".ts"],
      denyPatterns: ["**/.env", "**/node_modules/**", "**/.git/**"],
    },
    ...overrides,
  } as unknown as BridgeConfig;
}

describe("filesystemAccess", () => {
  it("collectReadableTextFiles skips denied paths like .env", async () => {
    const repo = createTempRepo();
    try {
      fs.mkdirSync(path.join(repo.dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(repo.dir, ".env"), "SECRET=1\n");
      fs.writeFileSync(
        path.join(repo.dir, "src", "a.ts"),
        "export const a=1;\n",
      );

      const extra = createExtraWithRoot(repo.dir);
      const result = await collectReadableTextFiles(baseConfig(), extra, ["."]);

      expect(result.files.map((f) => f.relativePath)).toEqual(["src/a.ts"]);
      expect(result.files.some((f) => f.relativePath === ".env")).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("collectReadableTextFiles skips files that exceed maxFileBytes", async () => {
    const repo = createTempRepo();
    try {
      fs.writeFileSync(path.join(repo.dir, "big.ts"), "x".repeat(10));
      const extra = createExtraWithRoot(repo.dir);
      const result = await collectReadableTextFiles(
        baseConfig({
          filesystem: {
            ...(baseConfig().filesystem as BridgeConfig["filesystem"]),
            maxFileBytes: 5,
          },
        }),
        extra,
        ["."],
      );

      expect(result.files).toHaveLength(0);
      expect(result.skipped[0]?.reason).toContain("File too large");
    } finally {
      repo.cleanup();
    }
  });

  it("parseUnifiedDiff parses simple unified diffs", () => {
    const parsed = parseUnifiedDiff(
      ["--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-x", "+y", ""].join("\n"),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.newPath).toBe("a.txt");
    expect(parsed[0]?.hunks).toHaveLength(1);
  });

  it("applyUnifiedDiffToFilesystem applies a patch within MCP roots", async () => {
    const repo = createTempRepo();
    try {
      const filePath = path.join(repo.dir, "a.txt");
      fs.writeFileSync(filePath, "hello\nworld\n");
      const diff = [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,2 +1,2 @@",
        " hello",
        "-world",
        "+there",
        "",
      ].join("\n");

      const extra = createExtraWithRoot(repo.dir);
      const logger = createLogger();
      await applyUnifiedDiffToFilesystem(
        baseConfig({
          filesystem: {
            ...(baseConfig().filesystem as BridgeConfig["filesystem"]),
            allowWrite: true,
          },
        }),
        extra,
        diff,
        logger,
      );

      const updated = await fsp.readFile(filePath, "utf-8");
      expect(updated).toBe("hello\nthere\n");
    } finally {
      repo.cleanup();
    }
  });

  it("applyUnifiedDiffToFilesystem refuses deletions", async () => {
    const repo = createTempRepo();
    try {
      const filePath = path.join(repo.dir, "a.txt");
      fs.writeFileSync(filePath, "hello\n");
      const diff = [
        "--- a/a.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-hello",
        "",
      ].join("\n");

      const extra = createExtraWithRoot(repo.dir);
      const logger = createLogger();
      await expect(
        applyUnifiedDiffToFilesystem(
          baseConfig({
            filesystem: {
              ...(baseConfig().filesystem as BridgeConfig["filesystem"]),
              allowWrite: true,
            },
          }),
          extra,
          diff,
          logger,
        ),
      ).rejects.toThrow("Refusing to apply file deletions");
    } finally {
      repo.cleanup();
    }
  });
});
