#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SERVER_NAME = "gemini";
const DEFAULT_COMMAND = "gemini-mcp-bridge";
const DEFAULT_ARGS = ["--stdio"];

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    users: [],
    allUsers: false,
    dryRun: false,
    codex: true,
    claudeDesktop: true,
    claudeCode: true,
    serverName: DEFAULT_SERVER_NAME,
    command: DEFAULT_COMMAND,
    args: DEFAULT_ARGS,
  };

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (a === "--all-users") {
      opts.allUsers = true;
      continue;
    }
    if (a === "--user") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --user");
      opts.users.push(value);
      continue;
    }
    if (a === "--server-name") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --server-name");
      opts.serverName = value;
      continue;
    }
    if (a === "--command") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --command");
      opts.command = value;
      continue;
    }
    if (a === "--no-codex") {
      opts.codex = false;
      continue;
    }
    if (a === "--no-claude-desktop") {
      opts.claudeDesktop = false;
      continue;
    }
    if (a === "--no-claude-code") {
      opts.claudeCode = false;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  if (!opts.allUsers && opts.users.length === 0) {
    opts.allUsers = true;
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`Configure Gemini MCP Bridge for Codex + Claude.\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(
    `  node scripts/configure-mcp-users.mjs --all-users [--dry-run]\n`,
  );
  process.stdout.write(
    `  node scripts/configure-mcp-users.mjs --user <name> [--dry-run]\n\n`,
  );
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --all-users           Configure all human users\n`);
  process.stdout.write(`  --user <name>         Configure a specific user\n`);
  process.stdout.write(`  --dry-run             Print what would change\n`);
  process.stdout.write(`  --no-codex             Skip Codex CLI config\n`);
  process.stdout.write(`  --no-claude-desktop    Skip Claude Desktop config\n`);
  process.stdout.write(`  --no-claude-code       Skip Claude Code config\n`);
  process.stdout.write(`  --server-name <name>   MCP server name (default: gemini)\n`);
  process.stdout.write(`  --command <cmd>        Command (default: gemini-mcp-bridge)\n`);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function writeTextFile(filePath, content, { mode, uid, gid, dryRun }) {
  if (dryRun) return;
  fs.writeFileSync(filePath, content, "utf8");
  if (typeof mode === "number") fs.chmodSync(filePath, mode);
  if (
    typeof uid === "number" &&
    typeof gid === "number" &&
    typeof process.geteuid === "function" &&
    process.geteuid() === 0
  ) {
    fs.chownSync(filePath, uid, gid);
  }
}

function ensureDir(dirPath, { mode, uid, gid, dryRun }) {
  if (!fs.existsSync(dirPath)) {
    if (!dryRun) fs.mkdirSync(dirPath, { recursive: true, mode });
  }
  if (!dryRun) {
    if (typeof mode === "number") fs.chmodSync(dirPath, mode);
    if (
      typeof uid === "number" &&
      typeof gid === "number" &&
      typeof process.geteuid === "function" &&
      process.geteuid() === 0
    ) {
      fs.chownSync(dirPath, uid, gid);
    }
  }
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTomlTableRange(content, tableName) {
  const headerRe = new RegExp(`^\\[${escapeRegExp(tableName)}\\]\\s*$`, "m");
  const match = headerRe.exec(content);
  if (!match) return null;
  const start = match.index;
  const afterHeaderIdx = content.indexOf("\n", start);
  const searchFrom = afterHeaderIdx === -1 ? content.length : afterHeaderIdx + 1;
  const nextHeaderRe = /^\[/m;
  nextHeaderRe.lastIndex = searchFrom;
  const nextMatch = nextHeaderRe.exec(content.slice(searchFrom));
  const end = nextMatch ? searchFrom + nextMatch.index : content.length;
  return { start, end };
}

function upsertTomlKeyInTable(content, tableName, key, valueLine) {
  const range = findTomlTableRange(content, tableName);
  if (!range) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    return (
      content +
      `${suffix}\n[${tableName}]\n${valueLine}\n`
    );
  }

  const before = content.slice(0, range.start);
  const tableBlock = content.slice(range.start, range.end);
  const after = content.slice(range.end);

  const lines = tableBlock.split("\n");
  const headerLine = lines.shift();
  if (headerLine === undefined) return content;

  let found = false;
  const updated = lines.map((line) => {
    const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
    if (re.test(line)) {
      found = true;
      return valueLine;
    }
    return line;
  });
  if (!found) {
    updated.unshift(valueLine);
  }

  const rebuilt = [headerLine, ...updated].join("\n");
  return before + rebuilt + after;
}

function ensureTomlTable(content, tableName) {
  const exists = new RegExp(`^\\[${escapeRegExp(tableName)}\\]\\s*$`, "m").test(
    content,
  );
  if (exists) return content;
  const suffix = content.endsWith("\n") ? "" : "\n";
  return content + `${suffix}\n[${tableName}]\n`;
}

function upsertCodexConfig(content, { serverName, command, args }) {
  let out = content ?? "";
  out = out.replace(/\r\n/g, "\n");
  if (out.length > 0 && !out.endsWith("\n")) out += "\n";

  const table = `mcp_servers.${serverName}`;
  out = ensureTomlTable(out, table);
  out = upsertTomlKeyInTable(out, table, "command", `command = "${command}"`);
  out = upsertTomlKeyInTable(
    out,
    table,
    "args",
    `args = ${JSON.stringify(args)}`,
  );

  const envTable = `${table}.env`;
  out = ensureTomlTable(out, envTable);
  out = upsertTomlKeyInTable(
    out,
    envTable,
    "GEMINI_MCP_AUTH_MODE",
    `GEMINI_MCP_AUTH_MODE = "auto"`,
  );

  return out;
}

function upsertClaudeDesktopConfig(obj, { serverName, command, args }) {
  const out = isPlainObject(obj) ? obj : {};
  if (!isPlainObject(out.mcpServers)) out.mcpServers = {};
  out.mcpServers[serverName] = { command, args };
  return out;
}

function upsertClaudeCodeConfig(obj, { serverName, command, args }, homeDir) {
  const out = isPlainObject(obj) ? obj : {};
  if (!isPlainObject(out.projects)) out.projects = {};
  const projects = out.projects;

  const ensureProject = (projectPath) => {
    const existing = projects[projectPath];
    if (!isPlainObject(existing)) {
      projects[projectPath] = {
        allowedTools: [],
        mcpContextUris: [],
        mcpServers: {},
        enabledMcpjsonServers: [],
        disabledMcpjsonServers: [],
        hasTrustDialogAccepted: false,
        projectOnboardingSeenCount: 0,
        hasClaudeMdExternalIncludesApproved: false,
        hasClaudeMdExternalIncludesWarningShown: false,
      };
    } else if (!isPlainObject(existing.mcpServers)) {
      existing.mcpServers = {};
    }
  };

  const projectKeys = Object.keys(projects);
  if (projectKeys.length === 0) {
    ensureProject(homeDir);
  }

  for (const projectPath of Object.keys(projects)) {
    ensureProject(projectPath);
    projects[projectPath].mcpServers[serverName] = {
      type: "stdio",
      command,
      args,
      env: { GEMINI_MCP_AUTH_MODE: "auto" },
    };
  }

  return out;
}

function readPasswdUsers() {
  const raw = fs.readFileSync("/etc/passwd", "utf8");
  const users = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts.length < 7) continue;
    const [name, _pw, uidStr, gidStr, _gecos, home, shell] = parts;
    const uid = Number(uidStr);
    const gid = Number(gidStr);
    if (!Number.isFinite(uid) || !Number.isFinite(gid)) continue;
    users.push({ name, uid, gid, home, shell });
  }
  return users;
}

function defaultUserFilter(user) {
  if (user.uid < 1000) return false;
  if (!user.home || !user.home.startsWith("/home/")) return false;
  if (!fs.existsSync(user.home)) return false;
  const shell = user.shell || "";
  if (shell.includes("nologin") || shell.includes("/bin/false")) return false;
  return true;
}

function configureUser(user, opts) {
  const changes = [];

  if (opts.codex) {
    const codexDir = path.join(user.home, ".codex");
    ensureDir(codexDir, {
      mode: 0o700,
      uid: user.uid,
      gid: user.gid,
      dryRun: opts.dryRun,
    });
    const codexConfigPath = path.join(codexDir, "config.toml");
    const before = readTextIfExists(codexConfigPath) ?? "";
    const after = upsertCodexConfig(before, opts);
    if (after !== before) {
      changes.push(`Codex: ${codexConfigPath}`);
      writeTextFile(codexConfigPath, after, {
        mode: 0o600,
        uid: user.uid,
        gid: user.gid,
        dryRun: opts.dryRun,
      });
    }
  }

  if (opts.claudeDesktop) {
    const claudeDir = path.join(user.home, ".config", "Claude");
    ensureDir(claudeDir, {
      mode: 0o700,
      uid: user.uid,
      gid: user.gid,
      dryRun: opts.dryRun,
    });
    const claudeConfigPath = path.join(claudeDir, "claude_desktop_config.json");
    const beforeText = readTextIfExists(claudeConfigPath);
    let beforeObj = {};
    if (beforeText) {
      try {
        beforeObj = JSON.parse(beforeText);
      } catch {
        // If config is invalid JSON, back it up and replace with a valid one.
        const backupPath = `${claudeConfigPath}.bak-${Date.now()}`;
        changes.push(`Claude Desktop: invalid JSON backed up to ${backupPath}`);
        if (!opts.dryRun) fs.copyFileSync(claudeConfigPath, backupPath);
        beforeObj = {};
      }
    }
    const afterObj = upsertClaudeDesktopConfig(beforeObj, opts);
    const afterText = JSON.stringify(afterObj, null, 2) + "\n";
    if ((beforeText ?? "") !== afterText) {
      changes.push(`Claude Desktop: ${claudeConfigPath}`);
      writeTextFile(claudeConfigPath, afterText, {
        mode: 0o600,
        uid: user.uid,
        gid: user.gid,
        dryRun: opts.dryRun,
      });
    }
  }

  if (opts.claudeCode) {
    const claudeCodePath = path.join(user.home, ".claude.json");
    const beforeText = readTextIfExists(claudeCodePath);
    let beforeObj = {};
    if (beforeText) {
      try {
        beforeObj = JSON.parse(beforeText);
      } catch {
        const backupPath = `${claudeCodePath}.bak-${Date.now()}`;
        changes.push(`Claude Code: invalid JSON backed up to ${backupPath}`);
        if (!opts.dryRun) fs.copyFileSync(claudeCodePath, backupPath);
        beforeObj = {};
      }
    }
    const afterObj = upsertClaudeCodeConfig(beforeObj, opts, user.home);
    const afterText = JSON.stringify(afterObj, null, 2) + "\n";
    if ((beforeText ?? "") !== afterText) {
      changes.push(`Claude Code: ${claudeCodePath}`);
      writeTextFile(claudeCodePath, afterText, {
        mode: 0o600,
        uid: user.uid,
        gid: user.gid,
        dryRun: opts.dryRun,
      });
    }
  }

  return changes;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const passwdUsers = readPasswdUsers();
  const selectedUsers =
    opts.allUsers && opts.users.length === 0
      ? passwdUsers.filter(defaultUserFilter)
      : passwdUsers.filter((u) => opts.users.includes(u.name));

  if (selectedUsers.length === 0) {
    process.stderr.write(
      `No users selected. Use --all-users or --user <name>.\n`,
    );
    process.exit(1);
  }

  const allChanges = [];
  for (const user of selectedUsers) {
    const changes = configureUser(user, opts);
    if (changes.length > 0) {
      allChanges.push({ user: user.name, changes });
    }
  }

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify({ dryRun: true, allChanges }, null, 2));
    process.stdout.write("\n");
    return;
  }

  process.stdout.write(
    JSON.stringify({ ok: true, configuredUsers: allChanges }, null, 2) + "\n",
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    error instanceof Error ? `${error.message}\n` : `${String(error)}\n`,
  );
  process.exit(1);
}
