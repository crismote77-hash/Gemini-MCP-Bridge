import fs from "node:fs";
import path from "node:path";

function isoUtcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function rotateIfNeeded(runbookPath, archiveDir, maxBytes) {
  if (!fs.existsSync(runbookPath)) return;
  const stats = fs.statSync(runbookPath);
  if (stats.size <= maxBytes) return;

  ensureDir(archiveDir);
  const stamp = isoUtcNow().replaceAll(":", "").replace("Z", "Z");
  const archivedName = `runbook_${stamp}.md`;
  const archivedPath = path.join(archiveDir, archivedName);
  fs.renameSync(runbookPath, archivedPath);

  const header = `# Runbook (Rotating)\n\nArchived previous runbook to \`${archivedPath}\`.\n\n---\n\n`;
  fs.writeFileSync(runbookPath, header, "utf-8");
}

function main() {
  const args = process.argv.slice(2);
  const note = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!note) {
    process.stderr.write('Usage: npm run runbook:note -- "note text"\n');
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const runbookPath = path.join(repoRoot, "runbook.md");
  const archiveDir = path.join(repoRoot, "archive", "runbook");

  rotateIfNeeded(runbookPath, archiveDir, 200_000);

  const ts = isoUtcNow();
  const entry = `## ${ts}\n\n- ${note}\n\n`;
  fs.appendFileSync(runbookPath, entry, "utf-8");

  process.stdout.write(`ok: appended runbook entry at ${ts}\n`);
}

main();
