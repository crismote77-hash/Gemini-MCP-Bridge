import fs from "node:fs";
import path from "node:path";

function isoUtcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function safePreview(text, maxChars = 320) {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}…`;
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-goog-api-key": apiKey,
    },
  });

  const contentType = res.headers.get("content-type") ?? "unknown";
  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(
      `Gemini API request failed (HTTP ${res.status}; content-type ${contentType}). Body starts with: ${JSON.stringify(
        safePreview(bodyText),
      )}`,
    );
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Non-JSON response from Gemini API (HTTP ${res.status}; content-type ${contentType}). Body starts with: ${JSON.stringify(
        safePreview(bodyText),
      )}`,
    );
  }
}

async function listAllModels({ apiBaseUrl, apiKey }) {
  const models = [];
  let pageToken;

  for (let page = 0; page < 50; page += 1) {
    const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson(url.toString(), apiKey);
    const batch = Array.isArray(json?.models) ? json.models : [];
    models.push(...batch);

    if (typeof json?.nextPageToken === "string" && json.nextPageToken) {
      pageToken = json.nextPageToken;
      continue;
    }
    break;
  }

  return models;
}

function stripModelPrefix(name) {
  if (name.startsWith("models/")) return name.slice("models/".length);
  return name;
}

function toSortedUniqueStringArray(value) {
  if (!Array.isArray(value)) return [];
  const filtered = value.filter((v) => typeof v === "string");
  return Array.from(new Set(filtered)).sort();
}

function normalizeModels(rawModels) {
  const out = {};
  for (const raw of rawModels) {
    const nameRaw = typeof raw?.name === "string" ? raw.name : undefined;
    if (!nameRaw) continue;

    const name = stripModelPrefix(nameRaw);
    const supportedGenerationMethods = toSortedUniqueStringArray(
      raw?.supportedGenerationMethods,
    );

    out[name] = {
      name,
      rawName: nameRaw,
      supportedGenerationMethods,
    };
  }
  return out;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function diffModelMaps(prevModels, nextModels) {
  const prevNames = new Set(Object.keys(prevModels));
  const nextNames = new Set(Object.keys(nextModels));

  const addedModels = Array.from(nextNames)
    .filter((n) => !prevNames.has(n))
    .sort();
  const removedModels = Array.from(prevNames)
    .filter((n) => !nextNames.has(n))
    .sort();

  const common = Array.from(prevNames).filter((n) => nextNames.has(n)).sort();
  const changedModels = [];
  for (const name of common) {
    const before = toSortedUniqueStringArray(
      prevModels[name]?.supportedGenerationMethods,
    );
    const after = toSortedUniqueStringArray(
      nextModels[name]?.supportedGenerationMethods,
    );
    if (!arraysEqual(before, after)) {
      changedModels.push({ name, before, after });
    }
  }

  const prevMethods = new Set(
    Object.values(prevModels).flatMap((m) =>
      toSortedUniqueStringArray(m?.supportedGenerationMethods),
    ),
  );
  const nextMethods = new Set(
    Object.values(nextModels).flatMap((m) =>
      toSortedUniqueStringArray(m?.supportedGenerationMethods),
    ),
  );

  const addedGenerationMethods = Array.from(nextMethods)
    .filter((m) => !prevMethods.has(m))
    .sort();
  const removedGenerationMethods = Array.from(prevMethods)
    .filter((m) => !nextMethods.has(m))
    .sort();

  return {
    addedModels,
    removedModels,
    changedModels,
    addedGenerationMethods,
    removedGenerationMethods,
  };
}

function formatCodeList(items, maxItems = 30) {
  if (!items.length) return "None";
  const head = items.slice(0, maxItems);
  const rest = items.length - head.length;
  const formatted = head.map((v) => `\`${v}\``).join(", ");
  return rest > 0 ? `${formatted} …(+${rest} more)` : formatted;
}

function buildRunUrl() {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!serverUrl || !repo || !runId) return undefined;
  return `${serverUrl}/${repo}/actions/runs/${runId}`;
}

function buildIssueMarkdown({ timestamp, apiBaseUrl, diff }) {
  const runUrl = buildRunUrl();
  const date = timestamp.slice(0, 10);

  const lines = [];
  lines.push(`Gemini API radar detected changes in \`${apiBaseUrl}/models\`.`);
  lines.push("");
  lines.push(`- Detected at: \`${timestamp}\``);
  if (runUrl) lines.push(`- Workflow run: ${runUrl} (artifact: \`radar-report.json\`)`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Added models: ${diff.addedModels.length}`);
  lines.push(`- Removed models: ${diff.removedModels.length}`);
  lines.push(`- Models with method changes: ${diff.changedModels.length}`);
  lines.push(`- Added generation methods: ${diff.addedGenerationMethods.length}`);
  lines.push(`- Removed generation methods: ${diff.removedGenerationMethods.length}`);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- Added models: ${formatCodeList(diff.addedModels)}`);
  lines.push(`- Removed models: ${formatCodeList(diff.removedModels)}`);
  lines.push(`- Added generation methods: ${formatCodeList(diff.addedGenerationMethods)}`);
  lines.push(`- Removed generation methods: ${formatCodeList(diff.removedGenerationMethods)}`);

  if (diff.changedModels.length) {
    lines.push("");
    lines.push("### Method changes");
    lines.push("");
    const max = 50;
    const head = diff.changedModels.slice(0, max);
    for (const change of head) {
      lines.push(
        `- \`${change.name}\`: ${formatCodeList(change.before)} → ${formatCodeList(change.after)}`,
      );
    }
    const rest = diff.changedModels.length - head.length;
    if (rest > 0) lines.push(`- …(+${rest} more)`);
  }

  lines.push("");
  lines.push("## Next steps (MCP)");
  lines.push("");
  lines.push(
    "- Evaluate whether new models/methods imply new tools, parameter support, or curated metadata updates.",
  );
  lines.push(
    "- If changes affect users, update docs and `docs/CHANGELOG.md` accordingly.",
  );
  lines.push("");
  lines.push(`(Radar date: ${date})`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function writeGithubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const strValue = String(value);
  if (!strValue.includes("\n")) {
    fs.appendFileSync(outputPath, `${key}=${strValue}\n`, "utf-8");
    return;
  }

  const delimiter = `EOF_${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(
    outputPath,
    `${key}<<${delimiter}\n${strValue}\n${delimiter}\n`,
    "utf-8",
  );
}

function isValidStateFile(state) {
  if (!state || typeof state !== "object") return false;
  if (state.schemaVersion !== 1) return false;
  if (!state.models || typeof state.models !== "object") return false;
  return true;
}

async function main() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_MCP_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "error: missing API key (set GEMINI_API_KEY or GOOGLE_API_KEY in GitHub Secrets)\n",
    );
    process.exit(1);
  }

  const apiBaseUrl =
    process.env.GEMINI_API_RADAR_API_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta";
  const timestamp = isoUtcNow();

  const repoRoot = process.cwd();
  const cacheDir = path.join(repoRoot, ".radar_cache");
  const statePath = path.join(cacheDir, "state.json");
  const reportPath = path.join(cacheDir, "report.json");
  const issueBodyPath = path.join(cacheDir, "issue.md");

  ensureDir(cacheDir);

  const prevStateRaw = readJsonIfExists(statePath);
  const prevState = isValidStateFile(prevStateRaw) ? prevStateRaw : undefined;
  const baselineCreated = !prevState;

  const rawModels = await listAllModels({ apiBaseUrl, apiKey });
  const nextModels = normalizeModels(rawModels);

  const diff = prevState
    ? diffModelMaps(prevState.models ?? {}, nextModels)
    : diffModelMaps({}, nextModels);

  const shouldOpenIssue =
    !baselineCreated &&
    (diff.addedModels.length > 0 ||
      diff.removedModels.length > 0 ||
      diff.changedModels.length > 0 ||
      diff.addedGenerationMethods.length > 0 ||
      diff.removedGenerationMethods.length > 0);

  const report = {
    schemaVersion: 1,
    timestamp,
    apiBaseUrl,
    baselineCreated,
    shouldOpenIssue,
    previousTimestamp: prevState?.timestamp,
    previousModelCount: prevState ? Object.keys(prevState.models ?? {}).length : 0,
    currentModelCount: Object.keys(nextModels).length,
    diff,
  };

  writeJson(reportPath, report);

  if (shouldOpenIssue) {
    const issueMd = buildIssueMarkdown({ timestamp, apiBaseUrl, diff });
    fs.writeFileSync(issueBodyPath, issueMd, "utf-8");
  }

  const nextState = {
    schemaVersion: 1,
    timestamp,
    apiBaseUrl,
    models: nextModels,
  };
  writeJson(statePath, nextState);

  const date = timestamp.slice(0, 10);
  const issueTitle = `Gemini API radar: models/methods changed (${date})`;

  writeGithubOutput("should_open_issue", shouldOpenIssue ? "true" : "false");
  writeGithubOutput("baseline_created", baselineCreated ? "true" : "false");
  writeGithubOutput("issue_title", issueTitle);
  writeGithubOutput("issue_body_path", issueBodyPath);
  writeGithubOutput("report_path", reportPath);

  process.stdout.write(
    `ok: models=${report.currentModelCount} baselineCreated=${baselineCreated} shouldOpenIssue=${shouldOpenIssue}\n`,
  );
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
});

