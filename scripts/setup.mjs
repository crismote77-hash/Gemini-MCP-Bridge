#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_CONFIG_PATH = "~/.gemini-mcp-bridge/config.json";
const DEFAULT_API_KEY_PATH = "~/.gemini-mcp-bridge/api-key";
const SYSTEM_API_KEY_PATH = "/etc/gemini-mcp-bridge/api-key";
const DEFAULT_VERTEX_LOCATION = "us-central1";
const UI_DIVIDER = "=".repeat(60);
const COLOR_ENABLED =
  output.isTTY &&
  !process.env.NO_COLOR &&
  process.env.TERM &&
  process.env.TERM !== "dumb";
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
};

function colorize(text, code) {
  if (!COLOR_ENABLED) return text;
  return `${code}${text}${ANSI.reset}`;
}

function heading(text) {
  return colorize(text, ANSI.bold);
}

function question(text) {
  return colorize(text, ANSI.cyan);
}

function tip(text) {
  return colorize(text, ANSI.dim);
}

function ok(text) {
  return colorize(text, ANSI.green);
}

function warn(text) {
  return colorize(text, ANSI.yellow);
}

function expandHome(filePath) {
  if (!filePath.startsWith("~")) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    return version.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function isGitRepo(dirPath) {
  return fs.existsSync(path.join(dirPath, ".git"));
}

function findGitRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (isGitRepo(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isPathInside(parentDir, childPath) {
  const rel = path.relative(parentDir, childPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    configPath: undefined,
    backend: undefined,
    project: undefined,
    location: undefined,
    quotaProject: undefined,
    authFallback: undefined,
    skipGcloud: false,
    nonInteractive: false,
  };

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--config") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --config");
      opts.configPath = value;
      continue;
    }
    if (a === "--backend") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --backend");
      opts.backend = value;
      continue;
    }
    if (a === "--project") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --project");
      opts.project = value;
      continue;
    }
    if (a === "--location") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --location");
      opts.location = value;
      continue;
    }
    if (a === "--quota-project") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --quota-project");
      opts.quotaProject = value;
      continue;
    }
    if (a === "--auth-fallback") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --auth-fallback");
      const normalized = value.toLowerCase();
      if (!["auto", "prompt", "never"].includes(normalized)) {
        throw new Error("Invalid --auth-fallback (use auto, prompt, or never)");
      }
      opts.authFallback = normalized;
      continue;
    }
    if (a === "--skip-gcloud") {
      opts.skipGcloud = true;
      continue;
    }
    if (a === "--non-interactive") {
      opts.nonInteractive = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  return opts;
}

function printHelp() {
  process.stdout.write("Gemini MCP Bridge setup wizard.\n\n");
  process.stdout.write("Usage:\n");
  process.stdout.write(
    "  node scripts/setup.mjs [--config path] [--backend vertex|developer]\n",
  );
  process.stdout.write("Options:\n");
  process.stdout.write("  --config <path>       Config path override\n");
  process.stdout.write(
    "  --backend <name>      vertex or developer (defaults to prompt)\n",
  );
  process.stdout.write("  --project <id>        Vertex project id\n");
  process.stdout.write("  --location <region>   Vertex region\n");
  process.stdout.write("  --quota-project <id>  Vertex quota/billing project id\n");
  process.stdout.write(
    "  --auth-fallback <m>   auto, prompt, or never (fallback policy)\n",
  );
  process.stdout.write("  --skip-gcloud         Do not run gcloud commands\n");
  process.stdout.write("  --non-interactive     Disable prompts\n");
  process.stdout.write("  --help, -h            Show this help\n");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}

function ensureDir(dirPath) {
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

function ensureDirWithMode(dirPath, mode) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode });
    return;
  }
  try {
    fs.chmodSync(dirPath, mode);
  } catch {
    // Ignore chmod failures on unsupported platforms.
  }
}

function writeJsonFile(filePath, data) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const payload = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(filePath, payload, "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures on unsupported platforms.
  }
}

function writeTextFile(filePath, data, { mode, dirMode } = {}) {
  const dirPath = path.dirname(filePath);
  ensureDirWithMode(dirPath, dirMode ?? 0o700);
  fs.writeFileSync(filePath, data, "utf8");
  if (typeof mode === "number") {
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // Ignore chmod failures on unsupported platforms.
    }
  }
}

function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function readApiKeyFile(filePath) {
  const raw = readTextFileIfExists(filePath);
  if (!raw) return "";
  return raw.trim();
}

function removeFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore delete failures on unsupported platforms.
  }
}

function mergeConfig(existing, updates) {
  const out = isPlainObject(existing) ? { ...existing } : {};
  if (updates.backend) out.backend = updates.backend;
  out.auth = isPlainObject(out.auth) ? { ...out.auth } : {};
  if (updates.authMode) out.auth.mode = updates.authMode;
  if (updates.authFallbackPolicy)
    out.auth.fallbackPolicy = updates.authFallbackPolicy;
  if (typeof updates.apiKey === "string") out.auth.apiKey = updates.apiKey;
  if (updates.clearApiKey) delete out.auth.apiKey;

  if (
    updates.vertexProject ||
    updates.vertexLocation ||
    updates.vertexQuotaProject
  ) {
    out.vertex = isPlainObject(out.vertex) ? { ...out.vertex } : {};
    if (updates.vertexProject) out.vertex.project = updates.vertexProject;
    if (updates.vertexLocation) out.vertex.location = updates.vertexLocation;
    if (updates.vertexQuotaProject)
      out.vertex.quotaProject = updates.vertexQuotaProject;
  }

  if (updates.filesystemMode) {
    out.filesystem = isPlainObject(out.filesystem) ? { ...out.filesystem } : {};
    out.filesystem.mode = updates.filesystemMode;
  }

  return out;
}

function commandExists(command) {
  try {
    const result = spawnSync(command, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function readGcloudConfigValue(key) {
  try {
    const result = spawnSync(
      "gcloud",
      ["config", "get-value", key, "--quiet"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    const value = (result.stdout || "").trim();
    if (!value || value === "(unset)" || value === "unset") return null;
    return value;
  } catch {
    return null;
  }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function promptMenu(rl, title, options, defaultIndex) {
  process.stdout.write(question(`${title}\n`));
  options.forEach((opt, idx) => {
    process.stdout.write(`  ${idx + 1}) ${opt.label}\n`);
  });
  const hint =
    typeof defaultIndex === "number" ? ` [${defaultIndex + 1}]` : "";

  while (true) {
    const value = await rl.question(question(`Select${hint}: `));
    const trimmed = value.trim();
    if (!trimmed && typeof defaultIndex === "number") {
      return options[defaultIndex]?.value;
    }
    const choice = Number.parseInt(trimmed, 10);
    if (Number.isFinite(choice) && choice >= 1 && choice <= options.length) {
      return options[choice - 1]?.value;
    }
    process.stdout.write(
      warn(`Please enter a number between 1 and ${options.length}.\n`),
    );
  }
}

async function promptText(rl, label, options = {}) {
  const { required = false } = options;
  while (true) {
    const value = await rl.question(question(`${label}: `));
    const trimmed = value.trim();
    if (trimmed || !required) return trimmed;
    process.stdout.write(warn("This field is required.\n"));
  }
}

async function promptYesNo(rl, label, defaultYes) {
  return promptMenu(
    rl,
    label,
    [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ],
    defaultYes ? 0 : 1,
  );
}

async function promptSecret(rl, label, options = {}) {
  const { required = false } = options;
  const iface = rl;
  const outputStream = iface.output ?? output;
  const originalWrite = iface._writeToOutput?.bind(iface);
  const originalMuted = iface.stdoutMuted;

  while (true) {
    if (originalWrite) {
      iface._writeToOutput = (chunk) => {
        if (!iface.stdoutMuted) return originalWrite(chunk);
        if (chunk === "\n" || chunk === "\r\n") {
          outputStream.write(chunk);
          return;
        }
        if (chunk && chunk.trim() !== "") {
          outputStream.write("*");
        }
      };
    }
    outputStream.write(question(`${label}: `));
    iface.stdoutMuted = true;
    const value = await iface.question("");
    iface.stdoutMuted = false;
    if (originalWrite) iface._writeToOutput = originalWrite;
    if (typeof originalMuted !== "undefined") iface.stdoutMuted = originalMuted;
    const trimmed = value.trim();
    if (trimmed || !required) return trimmed;
    outputStream.write(warn("This field is required.\n"));
  }
}

function normalizeApiKey(value) {
  return value.trim();
}

function normalizeFallbackPolicy(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["auto", "prompt", "never"].includes(normalized)) return normalized;
  return undefined;
}

function readApiKeyFromConfig(config) {
  if (!isPlainObject(config)) return "";
  const auth = config.auth;
  if (!isPlainObject(auth)) return "";
  if (typeof auth.apiKey !== "string") return "";
  return auth.apiKey.trim();
}

function findExistingApiKey(config) {
  const configKey = readApiKeyFromConfig(config);
  if (configKey) {
    return { key: configKey, source: "config" };
  }

  const userPath = expandHome(DEFAULT_API_KEY_PATH);
  const userKey = readApiKeyFile(userPath);
  if (userKey) {
    return { key: userKey, source: "user_file", path: userPath };
  }

  const systemKey = readApiKeyFile(SYSTEM_API_KEY_PATH);
  if (systemKey) {
    return { key: systemKey, source: "system_file", path: SYSTEM_API_KEY_PATH };
  }

  return null;
}

function describeApiKeySource(info) {
  if (!info) return "none";
  if (info.source === "config") return "config file";
  if (info.source === "user_file") return "user key file";
  if (info.source === "system_file") return "system key file";
  return "unknown";
}

function canWriteSystemKey() {
  if (typeof process.getuid !== "function") return false;
  return process.getuid() === 0;
}

async function promptApiKeyStorage(rl, interactive) {
  const userPath = expandHome(DEFAULT_API_KEY_PATH);
  const userOption = {
    label: `This user only (${userPath})`,
    value: "user",
  };
  const systemOption = {
    label: `All users (system-wide: ${SYSTEM_API_KEY_PATH})`,
    value: "system",
  };

  if (!interactive) {
    return { path: userPath, mode: 0o600, dirMode: 0o700, label: "user file" };
  }

  if (!canWriteSystemKey()) {
    process.stdout.write(
      tip(
        "System-wide storage requires running setup with sudo. Using a per-user key file.\n\n",
      ),
    );
    return { path: userPath, mode: 0o600, dirMode: 0o700, label: "user file" };
  }

  const choice = await promptMenu(rl, "Where should we store the API key?", [
    userOption,
    systemOption,
  ]);
  if (choice === "system") {
    process.stdout.write(
      warn(
        "System-wide keys are readable by any local user on this machine.\n",
      ),
    );
    const proceed = await promptYesNo(
      rl,
      "Continue with system-wide storage?",
      false,
    );
    if (!proceed) {
      return { path: userPath, mode: 0o600, dirMode: 0o700, label: "user file" };
    }
    return {
      path: SYSTEM_API_KEY_PATH,
      mode: 0o644,
      dirMode: 0o755,
      label: "system file",
    };
  }
  return { path: userPath, mode: 0o600, dirMode: 0o700, label: "user file" };
}

function summarizeConfig(
  backend,
  authMode,
  vertexProject,
  vertexLocation,
  options = {},
) {
  const {
    maskValues = true,
    apiKeyStored,
    filesystemMode,
    authFallbackPolicy,
    vertexQuotaProject,
  } = options;
  const projectValue = vertexProject
    ? maskValues
      ? "(set)"
      : vertexProject
    : "missing";
  const locationValue = vertexLocation
    ? maskValues
      ? "(set)"
      : vertexLocation
    : "missing";
  const summary = {
    backend,
    auth: { mode: authMode },
  };
  if (typeof apiKeyStored === "string") {
    summary.auth.apiKey = apiKeyStored;
  } else if (typeof apiKeyStored === "boolean") {
    summary.auth.apiKey = apiKeyStored ? "(stored)" : "not stored";
  }
  if (authFallbackPolicy) {
    summary.auth.fallbackPolicy = authFallbackPolicy;
  }
  if (backend === "vertex") {
    summary.vertex = {
      project: projectValue,
      location: locationValue,
      quotaProject: vertexQuotaProject
        ? maskValues
          ? "(set)"
          : vertexQuotaProject
        : "missing",
    };
  }
  if (filesystemMode) {
    summary.filesystem = { mode: filesystemMode };
  }
  return summary;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const configPath = expandHome(opts.configPath || DEFAULT_CONFIG_PATH);
  const interactive =
    !opts.nonInteractive && input.isTTY && output.isTTY;
  const rl = interactive ? readline.createInterface({ input, output }) : null;

  process.stdout.write(`${UI_DIVIDER}\n`);
  process.stdout.write(heading("Gemini MCP Bridge guided setup\n"));
  process.stdout.write(`${UI_DIVIDER}\n`);
  process.stdout.write("This guided setup will:\n");
  process.stdout.write(
    "  1) choose a sign-in method (Google Cloud recommended)\n",
  );
  process.stdout.write("  2) collect project or API key settings\n");
  process.stdout.write("  3) optionally enable repo tools (code review/fix)\n");
  process.stdout.write(
    "  4) optionally run Google Cloud login steps for Vertex\n",
  );
  process.stdout.write(
    "  5) optionally configure MCP clients for this machine\n",
  );
  process.stdout.write("\n");
  process.stdout.write(tip("Privacy:\n"));
  process.stdout.write(
    tip("- API keys are stored only with explicit consent.\n"),
  );
  process.stdout.write(tip("- API key input is masked and never printed.\n"));
  process.stdout.write(
    tip("- Config is written outside this repo unless you pass --config.\n"),
  );
  process.stdout.write(
    tip("- Detected values are masked in summaries unless you open the config file.\n"),
  );
  process.stdout.write(tip("\nInput tips:\n"));
  process.stdout.write(tip("- Use numbers for menu choices.\n"));
  process.stdout.write(`\nConfig path: ${configPath}\n\n`);

  const resolvedConfigPath = path.resolve(configPath);
  const cwd = process.cwd();
  if (isGitRepo(cwd) && isPathInside(cwd, resolvedConfigPath)) {
    process.stdout.write(
      warn(
        "Warning: config path is inside this git repo. Config may contain secrets; avoid committing it.\n",
      ),
    );
    if (interactive) {
      const proceed = await promptYesNo(
        rl,
        "Continue with this config path?",
        false,
      );
      if (!proceed) {
        process.stdout.write(warn("Aborting without changes.\n"));
        process.exit(1);
      }
    } else {
      throw new Error("Config path is inside a git repo; aborting.");
    }
  }

  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = readJsonFile(configPath);
    } catch (error) {
      if (!interactive) throw error;
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(warn(`${message}\n`));
      const backupOk = await promptYesNo(
        rl,
        "Back up and replace the config file?",
        false,
      );
      if (!backupOk) {
        process.stdout.write(warn("Aborting without changes.\n"));
        process.exit(1);
      }
      const backupPath = `${configPath}.bak-${Date.now()}`;
      fs.copyFileSync(configPath, backupPath);
      process.stdout.write(ok(`Backed up to ${backupPath}\n`));
      existingConfig = {};
    }
  }
  const existingApiKey = findExistingApiKey(existingConfig);
  const existingFilesystemMode =
    isPlainObject(existingConfig) && isPlainObject(existingConfig.filesystem)
      ? existingConfig.filesystem.mode
      : undefined;
  const existingFallbackPolicy =
    isPlainObject(existingConfig) && isPlainObject(existingConfig.auth)
      ? normalizeFallbackPolicy(existingConfig.auth.fallbackPolicy)
      : undefined;

  process.stdout.write(heading("Step 1/5: Choose a sign-in method\n"));
  let backend = opts.backend?.toLowerCase();
  if (!backend) {
    if (!interactive) {
      throw new Error("Missing --backend (vertex or developer).");
    }
    backend = await promptMenu(
      rl,
      "Select a sign-in method:",
      [
        {
          label: "Google Cloud (Vertex, recommended; uses gcloud/ADC)",
          value: "vertex",
        },
        {
          label: "API key only (Developer API)",
          value: "developer",
        },
      ],
      0,
    );
  }
  if (backend !== "vertex" && backend !== "developer") {
    throw new Error("Backend must be vertex or developer.");
  }

  let project = opts.project;
  let location = opts.location;
  let quotaProject = opts.quotaProject;
  let authFallbackPolicy = opts.authFallback;
  let apiKey = "";
  let clearApiKey = false;
  let apiKeyStorageLabel = "not stored";
  let writeApiKeyFile = false;
  let apiKeyFileTarget = null;
  let apiKeyFileMode = null;
  let apiKeyFileDirMode = null;
  let removeApiKeyPath = null;
  let repoRootConfigured = false;
  if (backend === "vertex") {
    process.stdout.write(heading("\nStep 2/5: Vertex project + location\n"));
    process.stdout.write(tip("Why we need these:\n"));
    process.stdout.write(tip("- Project ID: billing/quota + API enablement.\n"));
    process.stdout.write(tip("- Location: region for the Vertex AI endpoint.\n"));
    process.stdout.write(tip("Where to find them:\n"));
    process.stdout.write(tip("- Cloud Console: Project info (Project ID).\n"));
    process.stdout.write(
      tip("- CLI: `gcloud projects list` or `gcloud config get-value project`.\n"),
    );
    process.stdout.write(
      tip("- Common regions: us-central1, us-east1, europe-west4.\n\n"),
    );

    const envProject =
      process.env.GEMINI_MCP_VERTEX_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.CLOUDSDK_CORE_PROJECT;
    const gcloudProject = commandExists("gcloud")
      ? readGcloudConfigValue("project")
      : null;
    const detectedProject = envProject || gcloudProject || "";

    if (!project && interactive && detectedProject) {
      const projectChoice = await promptMenu(
        rl,
        "Detected a project id in your environment (value hidden).",
        [
          { label: "Use detected project id", value: "use" },
          { label: "Enter manually", value: "manual" },
        ],
        1,
      );
      if (projectChoice === "use") project = detectedProject;
    }

    if (!project && interactive) {
      project = await promptText(rl, "Enter Vertex project id", {
        required: true,
      });
    }

    if (!project && !interactive) {
      if (detectedProject) project = detectedProject;
      else throw new Error("Missing --project for vertex backend.");
    }

    if (!location) {
      const envLocation =
        process.env.GEMINI_MCP_VERTEX_LOCATION ||
        process.env.GOOGLE_CLOUD_LOCATION;
      const detectedLocation = envLocation || "";

      if (interactive) {
        if (detectedLocation) {
          const locationChoice = await promptMenu(
            rl,
            "Detected a Vertex location in your environment (value hidden).",
            [
              { label: "Use detected location", value: "detected" },
              {
                label: `Use default ${DEFAULT_VERTEX_LOCATION}`,
                value: "default",
              },
              { label: "Enter manually", value: "manual" },
            ],
            1,
          );
          if (locationChoice === "detected") location = detectedLocation;
          if (locationChoice === "default") {
            location = DEFAULT_VERTEX_LOCATION;
          }
          if (locationChoice === "manual") {
            location = await promptText(rl, "Enter Vertex location", {
              required: true,
            });
          }
        } else {
          const locationChoice = await promptMenu(
            rl,
            "Choose a Vertex location:",
            [
              {
                label: `Use default ${DEFAULT_VERTEX_LOCATION}`,
                value: "default",
              },
              { label: "Enter manually", value: "manual" },
            ],
            0,
          );
          if (locationChoice === "default") {
            location = DEFAULT_VERTEX_LOCATION;
          }
          if (locationChoice === "manual") {
            location = await promptText(rl, "Enter Vertex location", {
              required: true,
            });
          }
        }
      } else {
        location = detectedLocation || DEFAULT_VERTEX_LOCATION;
      }
    }

    if (!project) throw new Error("Vertex project id is required.");
    if (!location) throw new Error("Vertex location is required.");

    if (!quotaProject) {
      const envQuotaProject =
        process.env.GEMINI_MCP_VERTEX_QUOTA_PROJECT ||
        process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||
        "";
      if (interactive) {
        process.stdout.write(heading("\nStep 2/5: Vertex quota project\n"));
        process.stdout.write(
          tip(
            "Quota/billing project is required by Vertex AI when using ADC.\n",
          ),
        );
        process.stdout.write(
          tip(
            `Press enter to use the Vertex project (${project}) if unsure.\n\n`,
          ),
        );
        if (envQuotaProject) {
          const quotaChoice = await promptMenu(
            rl,
            "Detected a quota project in your environment (value hidden).",
            [
              { label: "Use detected quota project", value: "detected" },
              { label: `Use ${project}`, value: "project" },
              { label: "Enter manually", value: "manual" },
            ],
            1,
          );
          if (quotaChoice === "detected") quotaProject = envQuotaProject;
          if (quotaChoice === "project") quotaProject = project;
          if (quotaChoice === "manual") {
            quotaProject = await promptText(rl, "Enter quota project id", {
              required: true,
            });
          }
        } else {
          const quotaChoice = await promptMenu(
            rl,
            "Choose a quota project:",
            [
              { label: `Use ${project}`, value: "project" },
              { label: "Enter manually", value: "manual" },
            ],
            0,
          );
          if (quotaChoice === "project") quotaProject = project;
          if (quotaChoice === "manual") {
            quotaProject = await promptText(rl, "Enter quota project id", {
              required: true,
            });
          }
        }
      } else {
        quotaProject = envQuotaProject || project;
      }
    }

    process.stdout.write(heading("\nStep 2/5: Backup API key (optional)\n"));
    process.stdout.write(
      tip(
        "If Google Cloud auth fails, the bridge can fall back to a Gemini API key.\n",
      ),
    );
    process.stdout.write(
      tip(
        "The key is stored only with your explicit consent and is never printed.\n\n",
      ),
    );

    const existingApiKeySource = existingApiKey
      ? describeApiKeySource(existingApiKey)
      : "";

    if (interactive) {
      if (existingApiKey) {
        const keyChoice = await promptMenu(
          rl,
          `A backup API key is already saved (${existingApiKeySource}). What would you like to do?`,
          [
            { label: "Keep existing backup key (recommended)", value: "keep" },
            { label: "Replace it with a new key", value: "replace" },
            { label: "Remove the saved key", value: "remove" },
          ],
          0,
        );
        if (keyChoice === "keep") {
          apiKeyStorageLabel = `stored (${existingApiKeySource})`;
        }
        if (keyChoice === "replace") {
          const rawKey = await promptSecret(rl, "Paste API key", {
            required: true,
          });
          apiKey = normalizeApiKey(rawKey);
          const save = await promptYesNo(
            rl,
            "Save this key on this computer? (recommended)",
            true,
          );
          if (save) {
            const storage = await promptApiKeyStorage(rl, interactive);
            apiKeyStorageLabel = `stored (${storage.label})`;
            apiKeyFileTarget = storage.path;
            apiKeyFileMode = storage.mode;
            apiKeyFileDirMode = storage.dirMode;
            writeApiKeyFile = true;
            if (existingApiKey.source === "config") {
              clearApiKey = true;
            }
            if (
              existingApiKey.path &&
              existingApiKey.path !== storage.path
            ) {
              removeApiKeyPath = existingApiKey.path;
            }
          } else {
            if (existingApiKey.source === "config") {
              clearApiKey = true;
            }
            if (existingApiKey.path) {
              removeApiKeyPath = existingApiKey.path;
            }
            apiKeyStorageLabel = "not stored";
            process.stdout.write(
              warn(
                "Key will not be saved. API key fallback will only work if GEMINI_API_KEY is set later.\n",
              ),
            );
          }
        }
        if (keyChoice === "remove") {
          if (existingApiKey.source === "config") {
            clearApiKey = true;
          }
          if (existingApiKey.path) {
            removeApiKeyPath = existingApiKey.path;
          }
          apiKeyStorageLabel = "not stored";
        }
      } else {
        const wantsBackup = await promptYesNo(
          rl,
          "Add a backup API key (used only if Google Cloud auth fails)?",
          true,
        );
        if (wantsBackup) {
          const rawKey = await promptSecret(rl, "Paste API key", {
            required: true,
          });
          apiKey = normalizeApiKey(rawKey);
          const save = await promptYesNo(
            rl,
            "Save this key on this computer? (recommended)",
            true,
          );
          if (save) {
            const storage = await promptApiKeyStorage(rl, interactive);
            apiKeyStorageLabel = `stored (${storage.label})`;
            apiKeyFileTarget = storage.path;
            apiKeyFileMode = storage.mode;
            apiKeyFileDirMode = storage.dirMode;
            writeApiKeyFile = true;
          } else {
            process.stdout.write(
              warn(
                "Key will not be saved. API key fallback will only work if GEMINI_API_KEY is set later.\n",
              ),
            );
          }
        }
      }
    } else if (existingApiKey) {
      apiKeyStorageLabel = `stored (${existingApiKeySource})`;
    }

    if (!authFallbackPolicy) {
      authFallbackPolicy =
        typeof existingFallbackPolicy === "string"
          ? existingFallbackPolicy
          : "prompt";
    }
    if (interactive) {
      process.stdout.write(
        heading("\nStep 2/5: API key fallback behavior\n"),
      );
      process.stdout.write(
        tip(
          "Choose what happens if Google Cloud auth fails and a key is available.\n\n",
        ),
      );
      const fallbackChoice = await promptMenu(
        rl,
        "When OAuth/ADC fails:",
        [
          { label: "Prompt before using API key (recommended)", value: "prompt" },
          { label: "Auto fallback to API key", value: "auto" },
          { label: "Never use API key fallback", value: "never" },
        ],
        authFallbackPolicy === "auto"
          ? 1
          : authFallbackPolicy === "never"
            ? 2
            : 0,
      );
      authFallbackPolicy = fallbackChoice;
    }
  } else {
    process.stdout.write(heading("\nStep 2/5: API key\n"));
    process.stdout.write(
      tip("This method uses a Gemini API key (Developer API).\n"),
    );
    process.stdout.write(
      tip("Create one at https://ai.google.dev/.\n\n"),
    );

    const existingApiKeySource = existingApiKey
      ? describeApiKeySource(existingApiKey)
      : "";

    if (interactive) {
      if (existingApiKey) {
        const keyChoice = await promptMenu(
          rl,
          `A saved API key was found (${existingApiKeySource}). What would you like to do?`,
          [
            { label: "Keep existing key (recommended)", value: "keep" },
            { label: "Replace it with a new key", value: "replace" },
            { label: "Remove the saved key", value: "remove" },
          ],
          0,
        );
        if (keyChoice === "keep") {
          apiKeyStorageLabel = `stored (${existingApiKeySource})`;
        }
        if (keyChoice === "replace") {
          const rawKey = await promptSecret(rl, "Paste API key", {
            required: true,
          });
          apiKey = normalizeApiKey(rawKey);
          const save = await promptYesNo(
            rl,
            "Save this key on this computer? (recommended)",
            true,
          );
          if (save) {
            const storage = await promptApiKeyStorage(rl, interactive);
            apiKeyStorageLabel = `stored (${storage.label})`;
            apiKeyFileTarget = storage.path;
            apiKeyFileMode = storage.mode;
            apiKeyFileDirMode = storage.dirMode;
            writeApiKeyFile = true;
            if (existingApiKey.source === "config") {
              clearApiKey = true;
            }
            if (
              existingApiKey.path &&
              existingApiKey.path !== storage.path
            ) {
              removeApiKeyPath = existingApiKey.path;
            }
          } else {
            if (existingApiKey.source === "config") {
              clearApiKey = true;
            }
            if (existingApiKey.path) {
              removeApiKeyPath = existingApiKey.path;
            }
            apiKeyStorageLabel = "not stored";
            process.stdout.write(
              warn(
                "Key will not be saved. You must set GEMINI_API_KEY before starting the server.\n",
              ),
            );
          }
        }
        if (keyChoice === "remove") {
          if (existingApiKey.source === "config") {
            clearApiKey = true;
          }
          if (existingApiKey.path) {
            removeApiKeyPath = existingApiKey.path;
          }
          apiKeyStorageLabel = "not stored";
          process.stdout.write(
            warn(
              "Saved key removed. You must set GEMINI_API_KEY before starting the server.\n",
            ),
          );
        }
      } else {
        const rawKey = await promptSecret(rl, "Paste API key", {
          required: true,
        });
        apiKey = normalizeApiKey(rawKey);
        const save = await promptYesNo(
          rl,
          "Save this key on this computer? (recommended)",
          true,
        );
        if (save) {
          const storage = await promptApiKeyStorage(rl, interactive);
          apiKeyStorageLabel = `stored (${storage.label})`;
          apiKeyFileTarget = storage.path;
          apiKeyFileMode = storage.mode;
          apiKeyFileDirMode = storage.dirMode;
          writeApiKeyFile = true;
        } else {
          process.stdout.write(
            warn(
              "Key will not be saved. You must set GEMINI_API_KEY before starting the server.\n",
            ),
          );
        }
      }
    } else if (existingApiKey) {
      apiKeyStorageLabel = `stored (${existingApiKeySource})`;
    }
  }

  if (!authFallbackPolicy) {
    authFallbackPolicy =
      typeof existingFallbackPolicy === "string"
        ? existingFallbackPolicy
        : "prompt";
  }

  const authMode = backend === "vertex" ? "auto" : "apiKey";
  let filesystemMode;
  if (interactive) {
    process.stdout.write(heading("\nStep 3/5: Repo tools (optional)\n"));
    process.stdout.write(
      tip(
        "Repo tools let the server read files from one folder you approve (for code review/fix).\n",
      ),
    );
    process.stdout.write(
      tip(
        "You can enable them later; they are off by default for safety.\n\n",
      ),
    );
    const enableRepoTools = await promptYesNo(
      rl,
      "Enable repo tools (code review/fix)?",
      false,
    );
    if (enableRepoTools) filesystemMode = "repo";
  }

  const mergedConfig = mergeConfig(existingConfig, {
    backend,
    authMode,
    authFallbackPolicy,
    clearApiKey,
    vertexProject: backend === "vertex" ? project : undefined,
    vertexLocation: backend === "vertex" ? location : undefined,
    vertexQuotaProject: backend === "vertex" ? quotaProject : undefined,
    filesystemMode,
  });

  process.stdout.write("\n");
  process.stdout.write(heading("Planned configuration (values masked):\n"));
  process.stdout.write(
    JSON.stringify(
      summarizeConfig(backend, authMode, project, location, {
        apiKeyStored: apiKeyStorageLabel,
        filesystemMode: filesystemMode ?? existingFilesystemMode,
        authFallbackPolicy,
        vertexQuotaProject: backend === "vertex" ? quotaProject : undefined,
      }),
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(tip(`Tip: view the full config at ${configPath}\n`));

  let wroteConfig = false;
  let writeConfig = true;
  if (interactive) {
    writeConfig = await promptMenu(
      rl,
      "Write config file now?",
      [
        { label: "Yes (recommended)", value: true },
        { label: "No, I'll set env vars manually", value: false },
      ],
      0,
    );
  }
  if (writeConfig) {
    const hasConfigKey =
      isPlainObject(mergedConfig) &&
      isPlainObject(mergedConfig.auth) &&
      typeof mergedConfig.auth.apiKey === "string" &&
      mergedConfig.auth.apiKey.trim().length > 0;
    if (hasConfigKey && isGitRepo(cwd) && isPathInside(cwd, resolvedConfigPath)) {
      process.stdout.write(
        warn(
          "Config path is inside this git repo and will include a saved API key.\n",
        ),
      );
      if (interactive) {
        const proceed = await promptYesNo(
          rl,
          "Continue and write the config file here?",
          false,
        );
        if (!proceed) {
          process.stdout.write(warn("Aborting without changes.\n"));
          process.exit(1);
        }
      } else {
        throw new Error("Refusing to write a config file with secrets inside a git repo.");
      }
    }
    writeJsonFile(configPath, mergedConfig);
    wroteConfig = true;
    process.stdout.write(ok(`Wrote ${configPath}\n`));
  } else {
    process.stdout.write(warn("Skipped writing config file.\n"));
  }

  if (writeApiKeyFile && apiKey && apiKeyFileTarget) {
    writeTextFile(apiKeyFileTarget, `${apiKey}\n`, {
      mode: apiKeyFileMode ?? 0o600,
      dirMode: apiKeyFileDirMode ?? 0o700,
    });
    process.stdout.write(ok(`Saved API key to ${apiKeyFileTarget}\n`));
  }

  if (removeApiKeyPath) {
    removeFileIfExists(removeApiKeyPath);
    process.stdout.write(ok(`Removed API key file at ${removeApiKeyPath}\n`));
  }

  if (backend === "vertex" && !opts.skipGcloud) {
    const hasGcloud = commandExists("gcloud");
    if (!hasGcloud) {
      process.stdout.write(
        warn(
          "\n'gcloud' not found. Install the Google Cloud SDK to run the guided login steps.\n",
        ),
      );
    } else {
      process.stdout.write(
        heading(
          "\nStep 4/5: Optional gcloud setup (safe to skip if already done)\n",
        ),
      );
      process.stdout.write(
        tip("- gcloud auth login: sign in for CLI management\n"),
      );
      process.stdout.write(
        tip(
          "- gcloud auth application-default login: credentials used by this server\n",
        ),
      );
      process.stdout.write(
        tip("- gcloud config set project: default project for gcloud commands\n"),
      );
      process.stdout.write(
        tip(
          "- gcloud auth application-default set-quota-project: billing/quota linkage\n",
        ),
      );
      process.stdout.write(
        tip(
          "- gcloud services enable aiplatform.googleapis.com: enable Vertex AI API\n",
        ),
      );
      process.stdout.write(
        tip(
          "Note: gcloud may open a browser and print account info in the terminal.\n",
        ),
      );

      if (interactive) {
        const gcloudChoice = await promptMenu(
          rl,
          "Run gcloud setup now?",
          [
            { label: "Yes, guide me through each step", value: "guided" },
            { label: "No, skip", value: "skip" },
          ],
          1,
        );

        if (gcloudChoice === "guided") {
          const wslDetected = isWsl();
          let useNoBrowser = false;
          if (wslDetected) {
            process.stdout.write(
              tip(
                "\nWSL detected: use --no-launch-browser if the browser cannot open.\n",
              ),
            );
            useNoBrowser = await promptMenu(
              rl,
              "Use --no-launch-browser for gcloud login?",
              [
                { label: "Yes (recommended for WSL)", value: true },
                { label: "No", value: false },
              ],
              0,
            );
          }

          const runAuthLogin = await promptYesNo(
            rl,
            "Run 'gcloud auth login'?",
            false,
          );
          if (runAuthLogin) {
            const args = ["auth", "login"];
            if (useNoBrowser) args.push("--no-launch-browser");
            const code = await runCommand("gcloud", args);
            if (code !== 0) {
              process.stdout.write(warn("Command failed: gcloud auth login\n"));
            }
          }

          const runAdcLogin = await promptYesNo(
            rl,
            "Run 'gcloud auth application-default login'?",
            true,
          );
          if (runAdcLogin) {
            const args = ["auth", "application-default", "login"];
            if (useNoBrowser) args.push("--no-launch-browser");
            const code = await runCommand("gcloud", args);
            if (code !== 0) {
              process.stdout.write(
                warn("Command failed: gcloud auth application-default login\n"),
              );
            }
          }

          const runSetProject = await promptYesNo(
            rl,
            "Run 'gcloud config set project <your-project-id>'?",
            true,
          );
          if (runSetProject) {
            const code = await runCommand("gcloud", [
              "config",
              "set",
              "project",
              project,
            ]);
            if (code !== 0) {
              process.stdout.write(
                warn(
                  "Command failed: gcloud config set project <your-project-id>\n",
                ),
              );
            }
          }

          const runSetQuota = await promptYesNo(
            rl,
            "Run 'gcloud auth application-default set-quota-project <your-project-id>'?",
            true,
          );
          if (runSetQuota) {
            const code = await runCommand("gcloud", [
              "auth",
              "application-default",
              "set-quota-project",
              project,
            ]);
            if (code !== 0) {
              process.stdout.write(
                warn(
                  "Command failed: gcloud auth application-default set-quota-project <your-project-id>\n",
                ),
              );
            }
          }

          const runEnableApi = await promptYesNo(
            rl,
            "Enable Vertex AI API (aiplatform.googleapis.com)?",
            true,
          );
          if (runEnableApi) {
            const code = await runCommand("gcloud", [
              "services",
              "enable",
              "aiplatform.googleapis.com",
            ]);
            if (code !== 0) {
              process.stdout.write(
                warn(
                  "Command failed: gcloud services enable aiplatform.googleapis.com\n",
                ),
              );
            }
          }
        }
      }
    }
  }

  if (interactive) {
    process.stdout.write(
      heading("\nStep 5/5: Configure MCP clients (optional)\n"),
    );
    process.stdout.write(
      tip(
        "This can update Codex/Claude/Gemini CLI configs for one or more users.\n",
      ),
    );
    process.stdout.write(
      tip("Note: this step may print usernames and file paths in the terminal.\n"),
    );

    const userScope = await promptMenu(
      rl,
      "Which users should be configured?",
      [
        { label: "Current user (recommended)", value: "current" },
        { label: "All users (requires sudo)", value: "all" },
        { label: "Specific users", value: "list" },
        { label: "Skip", value: "skip" },
      ],
      0,
    );

    if (userScope !== "skip") {
      const clientScope = await promptMenu(
        rl,
        "Which clients should be configured?",
        [
          {
            label: "All (Codex + Claude Desktop + Claude Code + Gemini CLI)",
            value: "all",
          },
          { label: "Codex only", value: "codex" },
          { label: "Claude Desktop only", value: "claude-desktop" },
          { label: "Claude Code only", value: "claude-code" },
          { label: "Gemini CLI only", value: "gemini-cli" },
          { label: "Skip", value: "skip" },
        ],
        0,
      );

      if (clientScope !== "skip") {
        let userArgs = [];
        if (userScope === "current") {
          const username = os.userInfo().username;
          userArgs = ["--user", username];
        } else if (userScope === "all") {
          let proceed = true;
          if (typeof process.geteuid === "function" && process.geteuid() !== 0) {
            proceed = await promptYesNo(
              rl,
              "All users usually requires sudo. Continue anyway?",
              false,
            );
          }
          if (proceed) userArgs = ["--all-users"];
        } else if (userScope === "list") {
          const rawUsers = await promptText(
            rl,
            "Enter comma-separated usernames (example: alice,bob)",
            { required: true },
          );
          const list = rawUsers
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
          if (list.length === 0) {
            process.stdout.write(warn("No valid users entered. Skipping.\n"));
          } else {
            userArgs = list.flatMap((user) => ["--user", user]);
          }
        }

        if (userArgs.length > 0) {
          let rootPath;
          if (filesystemMode === "repo") {
            process.stdout.write(
              tip(
                "\nRepo tools need a single project folder to read. We'll configure a root for your MCP clients.\n",
              ),
            );
            process.stdout.write(
              tip("Avoid broad paths like / or your home directory.\n"),
            );
            const cwd = process.cwd();
            const gitRoot = findGitRoot(cwd);
            if (gitRoot) {
              const useDetected = await promptYesNo(
                rl,
                `Use detected project folder: ${gitRoot}?`,
                true,
              );
              if (useDetected) rootPath = gitRoot;
            }
            if (!rootPath) {
              const useCwd = await promptYesNo(
                rl,
                `Use current folder: ${cwd}?`,
                false,
              );
              if (useCwd) rootPath = cwd;
            }
            if (!rootPath) {
              const custom = await promptText(
                rl,
                "Enter a project folder (or leave blank to skip)",
              );
              if (custom) rootPath = custom;
            }

            if (rootPath) {
              repoRootConfigured = true;
              const resolvedRoot = path.resolve(rootPath);
              if (resolvedRoot === path.parse(resolvedRoot).root) {
                process.stdout.write(
                  warn(
                    "Warning: root is set to filesystem root (/). This is very broad.\n",
                  ),
                );
              }
              if (resolvedRoot === os.homedir()) {
                process.stdout.write(
                  warn(
                    "Warning: root is set to your home directory. Consider a narrower repo path.\n",
                  ),
                );
              }
              if (userScope !== "current") {
                process.stdout.write(
                  warn(
                    "Note: this root will be applied to all selected users.\n",
                  ),
                );
              }
            } else {
              process.stdout.write(
                warn(
                  "Repo tools were enabled but no root was set. You'll need to set a root later.\n",
                ),
              );
            }
          }

          const clientArgs = [];
          if (clientScope === "codex") {
            clientArgs.push(
              "--no-claude-desktop",
              "--no-claude-code",
              "--no-gemini-cli",
            );
          } else if (clientScope === "claude-desktop") {
            clientArgs.push(
              "--no-codex",
              "--no-claude-code",
              "--no-gemini-cli",
            );
          } else if (clientScope === "claude-code") {
            clientArgs.push(
              "--no-codex",
              "--no-claude-desktop",
              "--no-gemini-cli",
            );
          } else if (clientScope === "gemini-cli") {
            clientArgs.push(
              "--no-codex",
              "--no-claude-desktop",
              "--no-claude-code",
            );
          }

          const rootArgs = rootPath
            ? ["--root-path", rootPath]
            : [];

          const scriptPath = path.join(
            process.cwd(),
            "scripts",
            "configure-mcp-users.mjs",
          );
          if (!fs.existsSync(scriptPath)) {
            process.stdout.write(
              warn(
                `Missing ${scriptPath}. Skipping MCP client configuration.\n`,
              ),
            );
          } else {
            const code = await runCommand("node", [
              scriptPath,
              ...userArgs,
              ...clientArgs,
              ...rootArgs,
            ]);
            if (code !== 0) {
              process.stdout.write(
                warn(
                  "MCP client configuration failed. You can re-run it later.\n",
                ),
              );
            }
          }
        }
      }
    }
  }

  process.stdout.write("\n");
  process.stdout.write(heading("Next steps:\n"));
  if (!wroteConfig) {
    if (backend === "vertex") {
      process.stdout.write(
        "- Set GEMINI_MCP_BACKEND=vertex, GEMINI_MCP_VERTEX_PROJECT=<your-project-id>, GEMINI_MCP_VERTEX_LOCATION=<region>\n",
      );
    } else {
      process.stdout.write(
        "- Set GEMINI_API_KEY (or GOOGLE_API_KEY) and GEMINI_MCP_AUTH_MODE=apiKey\n",
      );
    }
  }
  const hasStoredKey = apiKeyStorageLabel !== "not stored";
  if (backend === "developer" && !hasStoredKey) {
    process.stdout.write(
      "- Export GEMINI_API_KEY in your shell before starting the server\n",
    );
  }
  if (backend === "vertex" && !hasStoredKey) {
    process.stdout.write(
      "- If Google Cloud auth fails, re-run setup to add a backup API key\n",
    );
  }
  if (filesystemMode === "repo" && !repoRootConfigured) {
    process.stdout.write(
      "- Configure a repo root in your MCP client so code review/fix can read files\n",
    );
  }
  process.stdout.write(
    "- Run `gemini-mcp-bridge --doctor --check-api` to validate\n",
  );
  process.stdout.write("- Start the server with `gemini-mcp-bridge --stdio`\n");
  process.stdout.write(
    "- Re-run guided setup anytime with `gemini-mcp-bridge --setup`\n",
  );
  process.stdout.write(
    "- Configure MCP clients later with `node scripts/configure-mcp-users.mjs --user <name>` or `--all-users`\n",
  );

  if (rl) rl.close();
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
