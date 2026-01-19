import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(rootDir, "dist", "index.js");

try {
  const stats = await fs.stat(entry);
  await fs.chmod(entry, stats.mode | 0o111);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`postbuild: failed to chmod dist/index.js: ${message}`);
  process.exit(1);
}
