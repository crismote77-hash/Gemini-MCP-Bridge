import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const MAX_STDERR_LINES = 60;
const HOST = process.env.HTTP_CLOSE_HOST ?? "127.0.0.1";
const PORT_RAW = process.env.HTTP_CLOSE_PORT;
const WAIT_TIMEOUT_MS = parseIntEnv("HTTP_CLOSE_WAIT_TIMEOUT_MS", 5_000);
const WAIT_INTERVAL_MS = 100;
const CAPTURE_STDERR =
  process.env.HTTP_CLOSE_CAPTURE_STDERR === "1" ||
  process.env.HTTP_CLOSE_DEBUG === "1";
const LIST_TOOLS = process.env.HTTP_CLOSE_LIST_TOOLS === "1";
const SKIP_CLIENT_CLOSE = process.env.HTTP_CLOSE_SKIP_CLIENT_CLOSE === "1";
const SKIP_SERVER_KILL = process.env.HTTP_CLOSE_SKIP_SERVER_KILL === "1";
const KILL_SIGNAL = process.env.HTTP_CLOSE_KILL_SIGNAL ?? "SIGTERM";

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePort(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

async function findAvailablePort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (typeof port === "number") {
          resolve(port);
          return;
        }
        reject(new Error("Unable to determine available port"));
      });
    });
  });
}

async function resolvePort() {
  const parsed = parsePort(PORT_RAW);
  if (parsed) return parsed;
  return findAvailablePort(HOST);
}

async function waitForPort(host, port) {
  const start = Date.now();
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    const ready = await new Promise((resolve) => {
      const socket = createConnection({ host, port });
      const onDone = (ok) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1_000, () => onDone(false));
      socket.once("connect", () => onDone(true));
      socket.once("error", () => onDone(false));
    });
    if (ready) return;
    await delay(WAIT_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for HTTP server on ${host}:${port}`);
}

function captureStderr(stream, stderrLines) {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(text);
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      stderrLines.push(line);
      if (stderrLines.length > MAX_STDERR_LINES) stderrLines.shift();
    }
  });
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill(KILL_SIGNAL);
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => proc.once("exit", resolve)),
    delay(2_000),
  ]);
  if (proc.exitCode !== null) return;
  try {
    proc.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => proc.once("exit", resolve)),
    delay(2_000),
  ]);
}

async function runStep(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { ok: true, durationMs: Date.now() - start, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, durationMs: Date.now() - start, error: message };
  }
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    http: {},
    steps: {},
    summary: {},
  };
  const port = await resolvePort();
  const url = `http://${HOST}:${port}/mcp`;
  report.http = { host: HOST, port, url };

  const stderrLines = [];
  const exitEvents = [];
  const child = spawn(
    "node",
    ["dist/index.js", "--http", "--http-host", HOST, "--http-port", `${port}`],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "ignore", CAPTURE_STDERR ? "pipe" : "inherit"],
    },
  );
  if (CAPTURE_STDERR && child.stderr) {
    captureStderr(child.stderr, stderrLines);
  }
  child.on("exit", (code, signal) => {
    exitEvents.push({
      code,
      signal,
      timestamp: new Date().toISOString(),
    });
  });

  const client = new Client({ name: "http-close-repro", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url);

  report.steps.connect = await runStep("connect", async () => {
    await waitForPort(HOST, port);
    await client.connect(transport);
  });

  if (LIST_TOOLS) {
    report.steps.listTools = await runStep("listTools", () =>
      client.listTools(),
    );
  }

  if (!SKIP_CLIENT_CLOSE) {
    report.steps.clientClose = await runStep("clientClose", () =>
      client.close(),
    );
  }

  if (!SKIP_SERVER_KILL) {
    report.steps.serverClose = await runStep("serverClose", () =>
      stopProcess(child),
    );
  }

  if (CAPTURE_STDERR && stderrLines.length > 0) {
    report.debug = { serverStderrTail: stderrLines };
  }
  if (exitEvents.length > 0) {
    report.debug = { ...(report.debug ?? {}), exitEvents };
  }

  const failedSteps = Object.values(report.steps).filter(
    (step) => step && step.ok === false,
  );
  report.summary = {
    ok: failedSteps.length === 0,
    failures: failedSteps.length,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failedSteps.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: message, timestamp: new Date().toISOString() }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
