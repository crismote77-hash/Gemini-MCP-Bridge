import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  type ServerNotification,
  type ServerRequest,
  ListRootsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

export type RootsExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export const unifiedDiffSchema = z.string().min(1);

export type FileRead = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  text: string;
};

export type FileReadSkipped = {
  path: string;
  reason: string;
};

export type CollectedFiles = {
  root: string;
  files: FileRead[];
  skipped: FileReadSkipped[];
  totalBytes: number;
};

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isSubpath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll("\\", "/");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (!ch) continue;
    if (ch === "*") {
      const next = normalized[i + 1];
      const next2 = normalized[i + 2];
      if (next === "*" && next2 === "/") {
        out += "(?:.*\\/)?";
        i += 2;
        continue;
      }
      if (next === "*") {
        out += ".*";
        i++;
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out, "i");
}

function matchesAnyPattern(candidatePath: string, patterns: string[]): boolean {
  const posix = toPosixPath(candidatePath);
  const posixWithSlash = posix.endsWith("/") ? posix : `${posix}/`;
  for (const pattern of patterns) {
    const re = globToRegExp(pattern);
    if (re.test(posix) || re.test(posixWithSlash)) return true;
  }
  return false;
}

export async function listClientRoots(extra: RootsExtra): Promise<string[]> {
  const result = await extra.sendRequest(
    { method: "roots/list" },
    ListRootsResultSchema,
  );
  return result.roots
    .map((root) => fileURLToPath(root.uri))
    .map((p) => path.resolve(p));
}

export function assertFilesystemModeAllowsReads(config: BridgeConfig): void {
  if (config.filesystem.mode === "off") {
    throw new Error(
      "Filesystem access is disabled. Set filesystem.mode=repo (requires MCP roots from your client) or filesystem.mode=system in config, or set GEMINI_MCP_FS_MODE.",
    );
  }
  if (config.filesystem.mode === "system" && !config.filesystem.allowSystem) {
    throw new Error(
      "filesystem.mode=system requires filesystem.allowSystem=true (or GEMINI_MCP_FS_ALLOW_SYSTEM=1).",
    );
  }
}

export function assertFilesystemModeAllowsWrites(config: BridgeConfig): void {
  assertFilesystemModeAllowsReads(config);
  if (!config.filesystem.allowWrite) {
    throw new Error(
      "Write access is disabled. Set filesystem.allowWrite=true (or GEMINI_MCP_FS_ALLOW_WRITE=1) to enable auto-apply.",
    );
  }
}

async function hasSymlinkInPath(
  rootPath: string,
  targetPath: string,
): Promise<boolean> {
  const rel = path.relative(rootPath, targetPath);
  if (!isSubpath(rootPath, targetPath)) return true;
  const segments = rel.split(path.sep).filter((s) => s.length > 0);
  let current = rootPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function isProbablyBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 1024);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function normalizeConfigExtensions(exts: string[]): Set<string> {
  return new Set(
    exts.map((ext) => ext.trim().toLowerCase()).filter((ext) => ext.length > 0),
  );
}

function pickRootForRelativeTargets(roots: string[]): string {
  if (roots.length === 0) {
    const fallback = process.env.GEMINI_MCP_FS_ROOT?.trim();
    if (fallback) {
      return path.resolve(fallback);
    }
    throw new Error(
      "No MCP roots available. Configure your MCP client to send a single repo/workspace root (or enable its auto-roots setting). Keep roots narrow to avoid over-sharing.",
    );
  }
  if (roots.length > 1) {
    throw new Error(
      "Multiple MCP roots are configured. Configure a single repo root (this server currently supports one root per request).",
    );
  }
  return roots[0];
}

function stripDotSlash(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "." || trimmed === "./") return ".";
  return trimmed.replace(/^\.\/+/, "");
}

async function resolveReadablePathInRepo(
  rootPath: string,
  target: string,
  opts: { followSymlinks: boolean; denyPatterns: string[] },
): Promise<{ absolute: string; relative: string }> {
  const cleaned = stripDotSlash(target);
  const absolute = path.resolve(rootPath, cleaned);
  const relative = toPosixPath(path.relative(rootPath, absolute));
  if (!isSubpath(rootPath, absolute)) {
    throw new Error(`Path escapes root: ${target}`);
  }
  if (matchesAnyPattern(relative, opts.denyPatterns)) {
    throw new Error(`Path denied by policy: ${target}`);
  }
  const realRoot = await fs.realpath(rootPath);
  const realTarget = await fs.realpath(absolute);
  if (!isSubpath(realRoot, realTarget)) {
    throw new Error(`Path escapes root via symlink: ${target}`);
  }
  if (!opts.followSymlinks) {
    const hasSymlink = await hasSymlinkInPath(rootPath, absolute);
    if (hasSymlink) throw new Error(`Path includes symlink: ${target}`);
  }
  return { absolute: realTarget, relative };
}

async function resolveReadablePathSystem(
  target: string,
  opts: { followSymlinks: boolean; denyPatterns: string[] },
): Promise<{ absolute: string; relative: string }> {
  const absolute = path.resolve(target);
  const relative = toPosixPath(absolute);
  if (matchesAnyPattern(relative, opts.denyPatterns)) {
    throw new Error(`Path denied by policy: ${target}`);
  }
  if (!opts.followSymlinks) {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`Path includes symlink: ${target}`);
  }
  const realTarget = await fs.realpath(absolute);
  return { absolute: realTarget, relative };
}

async function enumerateFilesUnderDirectory(
  rootPath: string,
  directoryPath: string,
  opts: {
    followSymlinks: boolean;
    denyPatterns: string[];
    allowedExtensions: Set<string>;
    maxFiles: number;
  },
): Promise<{
  files: Array<{ absolute: string; relative: string }>;
  skipped: FileReadSkipped[];
}> {
  const collected: Array<{ absolute: string; relative: string }> = [];
  const skipped: FileReadSkipped[] = [];
  const stack: string[] = [directoryPath];

  while (stack.length > 0 && collected.length < opts.maxFiles) {
    const current = stack.pop();
    if (!current) break;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      skipped.push({
        path: toPosixPath(path.relative(rootPath, current)),
        reason: `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (const entry of entries) {
      if (collected.length >= opts.maxFiles) break;
      const abs = path.join(current, entry.name);
      const rel = toPosixPath(path.relative(rootPath, abs));
      if (matchesAnyPattern(rel, opts.denyPatterns)) continue;

      let stat: import("node:fs").Stats;
      try {
        stat = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        if (!opts.followSymlinks) continue;
        // Avoid following symlinked directories (cycles / escapes). We allow symlinked files later via realpath checks.
        let targetStat: import("node:fs").Stats;
        try {
          targetStat = await fs.stat(abs);
        } catch {
          continue;
        }
        if (targetStat.isDirectory()) continue;
      }
      if (stat.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!stat.isFile()) continue;

      if (opts.allowedExtensions.size > 0) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext && !opts.allowedExtensions.has(ext)) continue;
      }

      collected.push({ absolute: abs, relative: rel });
    }
  }

  return { files: collected, skipped };
}

export async function collectReadableTextFiles(
  config: BridgeConfig,
  extra: RootsExtra,
  targets: string[],
): Promise<CollectedFiles> {
  assertFilesystemModeAllowsReads(config);

  const denyPatterns = config.filesystem.denyPatterns ?? [];
  const allowedExtensions = normalizeConfigExtensions(
    config.filesystem.allowedExtensions ?? [],
  );

  const maxFiles = config.filesystem.maxFiles;
  const maxFileBytes = config.filesystem.maxFileBytes;
  const maxTotalBytes = config.filesystem.maxTotalBytes;
  const followSymlinks = config.filesystem.followSymlinks;

  const roots =
    config.filesystem.mode === "repo" ? await listClientRoots(extra) : [];
  const rootPath =
    config.filesystem.mode === "repo"
      ? pickRootForRelativeTargets(roots)
      : path.parse(process.cwd()).root;

  const filesToRead: Array<{ absolute: string; relative: string }> = [];
  const skipped: FileReadSkipped[] = [];

  const normalizedTargets =
    targets.length > 0 ? targets.map((t) => t.trim()).filter(Boolean) : ["."];

  for (const target of normalizedTargets) {
    if (filesToRead.length >= maxFiles) break;

    if (config.filesystem.mode === "repo") {
      const { absolute, relative } = await resolveReadablePathInRepo(
        rootPath,
        target,
        {
          followSymlinks,
          denyPatterns,
        },
      );
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        const enumerated = await enumerateFilesUnderDirectory(
          rootPath,
          absolute,
          {
            followSymlinks,
            denyPatterns,
            allowedExtensions,
            maxFiles: maxFiles - filesToRead.length,
          },
        );
        filesToRead.push(...enumerated.files);
        skipped.push(...enumerated.skipped);
        continue;
      }
      if (stat.isFile()) {
        filesToRead.push({ absolute, relative });
      }
      continue;
    }

    const resolved = await resolveReadablePathSystem(target, {
      followSymlinks,
      denyPatterns,
    });
    const stat = await fs.stat(resolved.absolute);
    if (stat.isDirectory()) {
      const enumerated = await enumerateFilesUnderDirectory(
        resolved.absolute,
        resolved.absolute,
        {
          followSymlinks,
          denyPatterns,
          allowedExtensions,
          maxFiles: maxFiles - filesToRead.length,
        },
      );
      filesToRead.push(
        ...enumerated.files.map((f) => ({ ...f, relative: f.absolute })),
      );
      skipped.push(...enumerated.skipped);
      continue;
    }
    if (stat.isFile()) {
      filesToRead.push(resolved);
    }
  }

  const reads: FileRead[] = [];
  let totalBytes = 0;

  for (const file of filesToRead) {
    if (reads.length >= maxFiles) break;
    if (totalBytes >= maxTotalBytes) break;

    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(file.absolute);
    } catch (error) {
      skipped.push({
        path: file.relative,
        reason: `Failed to stat: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (stat.size > maxFileBytes) {
      skipped.push({
        path: file.relative,
        reason: `File too large (${stat.size} bytes > ${maxFileBytes})`,
      });
      continue;
    }
    if (totalBytes + stat.size > maxTotalBytes) {
      skipped.push({
        path: file.relative,
        reason: `Total bytes limit reached (${maxTotalBytes})`,
      });
      break;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(file.absolute);
    } catch (error) {
      skipped.push({
        path: file.relative,
        reason: `Failed to read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (isProbablyBinary(buffer)) {
      skipped.push({ path: file.relative, reason: "Binary file" });
      continue;
    }
    const text = buffer.toString("utf-8");
    reads.push({
      relativePath: file.relative,
      absolutePath: file.absolute,
      bytes: stat.size,
      text,
    });
    totalBytes += stat.size;
  }

  return { root: rootPath, files: reads, skipped, totalBytes };
}

function splitLinesPreserve(text: string): {
  lines: string[];
  endsWithNewline: boolean;
  lineEnding: "\n" | "\r\n";
} {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replaceAll("\r\n", "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return { lines, endsWithNewline, lineEnding };
}

function joinLinesPreserve(
  lines: string[],
  opts: { endsWithNewline: boolean; lineEnding: "\n" | "\r\n" },
): string {
  let out = lines.join("\n");
  if (opts.endsWithNewline) out += "\n";
  if (opts.lineEnding === "\r\n") out = out.replaceAll("\n", "\r\n");
  return out;
}

type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type UnifiedDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
};

function stripDiffPathPrefix(p: string): string {
  const trimmed = p.trim().split("\t")[0] ?? "";
  if (trimmed === "/dev/null") return "/dev/null";
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/"))
    return trimmed.slice(2);
  return trimmed;
}

export function parseUnifiedDiff(diffText: string): UnifiedDiffFile[] {
  const lines = diffText
    .split("\n")
    .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const files: UnifiedDiffFile[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.startsWith("--- ")) {
      i++;
      continue;
    }
    const oldRaw = stripDiffPathPrefix(line.slice(4));
    const next = lines[i + 1] ?? "";
    if (!next.startsWith("+++ ")) {
      throw new Error("Invalid unified diff: missing +++ line");
    }
    const newRaw = stripDiffPathPrefix(next.slice(4));
    const file: UnifiedDiffFile = {
      oldPath: oldRaw === "/dev/null" ? null : oldRaw,
      newPath: newRaw === "/dev/null" ? null : newRaw,
      hunks: [],
    };
    i += 2;

    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.startsWith("--- ")) break;
      if (!l.startsWith("@@ ")) {
        i++;
        continue;
      }
      const match =
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l) ?? null;
      if (!match) throw new Error(`Invalid unified diff hunk header: ${l}`);
      const oldStart = Number.parseInt(match[1] ?? "0", 10);
      const oldLines = Number.parseInt(match[2] ?? "1", 10);
      const newStart = Number.parseInt(match[3] ?? "0", 10);
      const newLines = Number.parseInt(match[4] ?? "1", 10);
      const hunkLines: string[] = [];
      i++;
      while (i < lines.length) {
        const hl = lines[i] ?? "";
        if (hl.startsWith("@@ ") || hl.startsWith("--- ")) break;
        if (hl.length === 0 || ![" ", "+", "-", "\\"].includes(hl[0] ?? ""))
          break;
        hunkLines.push(hl);
        i++;
      }
      file.hunks.push({
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: hunkLines,
      });
    }

    files.push(file);
  }

  return files;
}

function applyUnifiedDiffToText(
  originalText: string,
  hunks: DiffHunk[],
): string {
  const {
    lines: originalLines,
    endsWithNewline,
    lineEnding,
  } = splitLinesPreserve(originalText);
  const out: string[] = [];
  let originalIndex = 0;

  for (const hunk of hunks) {
    const targetIndex = Math.max(0, hunk.oldStart - 1);
    if (targetIndex < originalIndex) {
      throw new Error("Overlapping hunks are not supported");
    }
    out.push(...originalLines.slice(originalIndex, targetIndex));
    originalIndex = targetIndex;

    for (const rawLine of hunk.lines) {
      const tag = rawLine[0];
      if (tag === "\\") continue;
      const line = rawLine.slice(1);
      if (tag === " ") {
        if ((originalLines[originalIndex] ?? "") !== line) {
          throw new Error("Hunk context did not match file contents");
        }
        out.push(originalLines[originalIndex] ?? "");
        originalIndex++;
        continue;
      }
      if (tag === "-") {
        if ((originalLines[originalIndex] ?? "") !== line) {
          throw new Error("Hunk removal did not match file contents");
        }
        originalIndex++;
        continue;
      }
      if (tag === "+") {
        out.push(line);
        continue;
      }
      throw new Error(`Invalid unified diff line: ${rawLine}`);
    }
  }

  out.push(...originalLines.slice(originalIndex));
  return joinLinesPreserve(out, { endsWithNewline, lineEnding });
}

export async function applyUnifiedDiffToFilesystem(
  config: BridgeConfig,
  extra: RootsExtra,
  diffText: string,
  logger: Logger,
): Promise<{ applied: string[] }> {
  assertFilesystemModeAllowsWrites(config);

  const denyPatterns = config.filesystem.denyPatterns ?? [];
  const followSymlinks = config.filesystem.followSymlinks;

  const roots =
    config.filesystem.mode === "repo" ? await listClientRoots(extra) : [];
  const rootPath =
    config.filesystem.mode === "repo"
      ? pickRootForRelativeTargets(roots)
      : path.parse(process.cwd()).root;

  const parsed = parseUnifiedDiff(diffText);
  const pendingWrites: Array<{ filePath: string; newText: string }> = [];

  for (const filePatch of parsed) {
    if (!filePatch.newPath) {
      throw new Error("Refusing to apply file deletions");
    }
    if (!filePatch.oldPath) {
      throw new Error(
        "Refusing to auto-apply new files. Re-run with apply=false and apply the diff manually, or enable a future safe-create mode.",
      );
    }
    const patchPath = filePatch.newPath;

    let resolved: { absolute: string; relative: string };
    if (config.filesystem.mode === "repo") {
      resolved = await resolveReadablePathInRepo(rootPath, patchPath, {
        followSymlinks,
        denyPatterns,
      });
    } else {
      resolved = await resolveReadablePathSystem(patchPath, {
        followSymlinks,
        denyPatterns,
      });
    }

    let originalText = "";
    try {
      originalText = await fs.readFile(resolved.absolute, "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to read target file for patch (${patchPath}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const newText = applyUnifiedDiffToText(originalText, filePatch.hunks);
    pendingWrites.push({ filePath: resolved.absolute, newText });
  }

  for (const write of pendingWrites) {
    await fs.mkdir(path.dirname(write.filePath), { recursive: true });
    await fs.writeFile(write.filePath, write.newText, "utf-8");
  }

  logger.info("Applied unified diff", {
    files: pendingWrites.map((w) => w.filePath),
  });

  return { applied: pendingWrites.map((w) => w.filePath) };
}
