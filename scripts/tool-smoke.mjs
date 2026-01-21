import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const PNG_2X2_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADUlEQVQImWNgYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==";
const MAX_PREVIEW_CHARS = 240;
const MAX_STDERR_LINES = 40;
const DEBUG_ENABLED =
  process.env.TOOL_SMOKE_DEBUG === "1" || process.env.GEMINI_MCP_DEBUG === "1";
const TRACE_ENABLED = process.env.TOOL_SMOKE_TRACE === "1";
const CAPTURE_STDERR =
  process.env.TOOL_SMOKE_CAPTURE_STDERR === "1" || TRACE_ENABLED;
const IMAGE_BASE64 = process.env.TOOL_SMOKE_IMAGE_BASE64;
const DEFAULT_IMAGE_URL = "https://www.gstatic.com/webp/gallery/1.jpg";
const IMAGE_URL =
  process.env.TOOL_SMOKE_IMAGE_URL ??
  (IMAGE_BASE64 ? undefined : DEFAULT_IMAGE_URL);
const IMAGE_MIME = process.env.TOOL_SMOKE_IMAGE_MIME ?? "image/png";
const TRANSPORT_MODE_RAW = (
  process.env.TOOL_SMOKE_TRANSPORT ?? "auto"
).toLowerCase();
const TRANSPORT_MODE =
  TRANSPORT_MODE_RAW === "stdio" ||
  TRANSPORT_MODE_RAW === "http" ||
  TRANSPORT_MODE_RAW === "auto"
    ? TRANSPORT_MODE_RAW
    : "auto";
const HTTP_HOST = process.env.TOOL_SMOKE_HTTP_HOST ?? "127.0.0.1";
const HTTP_PORT_RAW = process.env.TOOL_SMOKE_HTTP_PORT;
const HTTP_READY_TIMEOUT_MS = 5_000;
const HTTP_READY_INTERVAL_MS = 100;

function truncate(text, limit = MAX_PREVIEW_CHARS) {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
}

function summarizeStructuredContent(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return { type: "object", keys: keys.slice(0, 5), keyCount: keys.length };
  }
  return { type: typeof value };
}

function summarizeToolResult(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const firstText = content.find((item) => item.type === "text")?.text ?? "";
  const structuredContent = Object.prototype.hasOwnProperty.call(
    result ?? {},
    "structuredContent",
  )
    ? result.structuredContent
    : undefined;
  return {
    isError: Boolean(result?.isError),
    contentItems: content.length,
    contentPreview: truncate(firstText),
    structuredContent: summarizeStructuredContent(structuredContent),
  };
}

function summarizeList(names) {
  return {
    count: names.length,
    sample: names.slice(0, 10),
  };
}

function trace(message) {
  if (!TRACE_ENABLED) return;
  process.stderr.write(`[tool-smoke] ${message}\n`);
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

async function resolveHttpPort() {
  const parsed = parsePort(HTTP_PORT_RAW);
  if (parsed) return parsed;
  return findAvailablePort(HTTP_HOST);
}

async function waitForPort(host, port) {
  const start = Date.now();
  while (Date.now() - start < HTTP_READY_TIMEOUT_MS) {
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
    await delay(HTTP_READY_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for HTTP server on ${host}:${port}`);
}

function buildServerEnv() {
  return {
    ...process.env,
    GEMINI_MCP_DEBUG: DEBUG_ENABLED ? "1" : process.env.GEMINI_MCP_DEBUG,
    GEMINI_MCP_FS_MODE: process.env.GEMINI_MCP_FS_MODE ?? "repo",
  };
}

function captureStderr(stream, stderrLines) {
  if (!stream) return;
  let stderrBuffer = "";
  stream.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(text);
    stderrBuffer += text;
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      stderrLines.push(line);
      if (stderrLines.length > MAX_STDERR_LINES) stderrLines.shift();
    }
  });
}

function createClient() {
  const client = new Client({ name: "tool-smoke", version: "0.1.0" });
  client.registerCapabilities({ roots: {} });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [
      {
        uri: pathToFileURL(process.cwd()).toString(),
        name: "workspace",
      },
    ],
  }));
  return client;
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill("SIGTERM");
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

function finalizeAttempt(attempt, context) {
  context.finalize();
  if (attempt.debug && Object.keys(attempt.debug).length === 0) {
    delete attempt.debug;
  }
}

function createStdioContext() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", "--stdio"],
    cwd: process.cwd(),
    env: buildServerEnv(),
    stderr: CAPTURE_STDERR ? "pipe" : "inherit",
  });
  const debug = {};
  const stderrLines = [];
  if (CAPTURE_STDERR && transport.stderr) {
    captureStderr(transport.stderr, stderrLines);
  }
  const closeEvents = [];
  const transportErrors = [];
  const exitEvents = [];
  if (TRACE_ENABLED) {
    const originalStart = transport.start.bind(transport);
    transport.start = async () => {
      await originalStart();
      const proc = transport._process;
      if (!proc) return;
      if (proc.spawnargs) debug.spawnArgs = proc.spawnargs;
      proc.on("exit", (code, signal) => {
        exitEvents.push({
          code,
          signal,
          timestamp: new Date().toISOString(),
        });
      });
    };
  }
  transport.onclose = () => {
    closeEvents.push({ timestamp: new Date().toISOString() });
    trace("stdio transport closed");
  };
  transport.onerror = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    transportErrors.push({ message, timestamp: new Date().toISOString() });
    trace(`stdio transport error: ${message}`);
  };

  return {
    kind: "stdio",
    transport,
    debug,
    finalize: () => {
      if (CAPTURE_STDERR) debug.serverStderrTail = stderrLines;
      if (closeEvents.length > 0) debug.closeEvents = closeEvents;
      if (transportErrors.length > 0)
        debug.transportErrors = transportErrors;
      if (exitEvents.length > 0) debug.exitEvents = exitEvents;
    },
  };
}

async function createHttpContext() {
  const host = HTTP_HOST;
  const port = await resolveHttpPort();
  const url = `http://${host}:${port}/mcp`;
  const child = spawn(
    "node",
    ["dist/index.js", "--http", "--http-host", host, "--http-port", `${port}`],
    {
      cwd: process.cwd(),
      env: buildServerEnv(),
      stdio: ["ignore", "ignore", CAPTURE_STDERR ? "pipe" : "inherit"],
    },
  );
  const debug = {};
  if (TRACE_ENABLED && child.spawnargs) {
    debug.spawnArgs = child.spawnargs;
  }
  const stderrLines = [];
  if (CAPTURE_STDERR && child.stderr) {
    captureStderr(child.stderr, stderrLines);
  }
  const closeEvents = [];
  const transportErrors = [];
  const exitEvents = [];
  const processErrors = [];
  child.on("exit", (code, signal) => {
    exitEvents.push({ code, signal, timestamp: new Date().toISOString() });
  });
  child.on("error", (error) => {
    processErrors.push({
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  });

  const transport = new StreamableHTTPClientTransport(url);
  transport.onclose = () => {
    closeEvents.push({ timestamp: new Date().toISOString() });
    trace("http transport closed");
  };
  transport.onerror = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    transportErrors.push({ message, timestamp: new Date().toISOString() });
    trace(`http transport error: ${message}`);
  };

  return {
    kind: "http",
    transport,
    debug,
    info: { host, port, url },
    close: async () => {
      await stopProcess(child);
    },
    finalize: () => {
      if (CAPTURE_STDERR) debug.serverStderrTail = stderrLines;
      if (closeEvents.length > 0) debug.closeEvents = closeEvents;
      if (transportErrors.length > 0)
        debug.transportErrors = transportErrors;
      if (exitEvents.length > 0) debug.exitEvents = exitEvents;
      if (processErrors.length > 0) debug.processErrors = processErrors;
    },
  };
}

async function runStep(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { ok: true, durationMs: Date.now() - start, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      durationMs: Date.now() - start,
      error: truncate(message, 400),
    };
  }
}

async function safeClose(client, context) {
  try {
    await client.close();
  } catch {
    // ignore
  }
  if (context?.close) {
    try {
      await context.close();
    } catch {
      // ignore
    }
  }
}

async function attemptTransport(kind) {
  let context;
  try {
    context = kind === "http" ? await createHttpContext() : createStdioContext();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      attempt: {
        kind,
        connect: {
          ok: false,
          durationMs: 0,
          error: truncate(message, 400),
        },
      },
    };
  }
  const client = createClient();
  const attempt = { kind, debug: context.debug };
  if (context.info) attempt.http = context.info;
  trace(`${kind} connect start`);
  const connectStep = await runStep("connect", async () => {
    if (kind === "http" && context.info) {
      await waitForPort(context.info.host, context.info.port);
    }
    await client.connect(context.transport);
  });
  attempt.connect = connectStep;
  if (!connectStep.ok) {
    await safeClose(client, context);
    finalizeAttempt(attempt, context);
    return { ok: false, attempt };
  }
  trace(`${kind} connect ok`);
  return { ok: true, client, context, attempt };
}

async function runTool(client, name, args, opts = {}) {
  const progressEvents = [];
  const onprogress = opts.onprogress
    ? (progress) => {
        progressEvents.push({
          progress: progress.progress,
          total: progress.total,
          message: truncate(progress.message ?? "", 120),
        });
      }
    : undefined;
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    onprogress ? { onprogress, resetTimeoutOnProgress: true } : undefined,
  );
  return {
    summary: summarizeToolResult(result),
    progressEvents,
  };
}

async function runToolWithRetry(client, test) {
  const maxAttempts = (test.retryOnError ?? 0) + 1;
  let totalDurationMs = 0;
  let attempts = 0;
  let step;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const args =
      attempt > 1 && test.retryArgs
        ? { ...test.args, ...test.retryArgs }
        : test.args;
    step = await runStep(test.name, () =>
      runTool(client, test.name, args, test.options),
    );
    totalDurationMs += step.durationMs;

    if (!step.ok) break;
    if (!step.result.summary.isError) break;
  }

  return { step, attempts, durationMs: totalDurationMs };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    transport: { mode: TRANSPORT_MODE, attempts: [] },
    tools: {},
    resources: {},
    prompts: {},
    listTools: {},
    listResources: {},
    listPrompts: {},
  };

  let failureCount = 0;
  const attemptOrder =
    TRANSPORT_MODE === "auto" ? ["stdio", "http"] : [TRANSPORT_MODE];
  let session = null;

  for (const kind of attemptOrder) {
    const result = await attemptTransport(kind);
    report.transport.attempts.push(result.attempt);
    if (result.ok) {
      session = result;
      report.transport.selected = kind;
      report.connect = result.attempt.connect;
      break;
    }
  }

  if (!session) {
    const lastAttempt =
      report.transport.attempts[report.transport.attempts.length - 1];
    if (lastAttempt?.connect) report.connect = lastAttempt.connect;
    if (lastAttempt?.debug) report.debug = lastAttempt.debug;
    report.summary = {
      ok: false,
      failures: 1,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const { client, context, attempt } = session;

  try {
    const listToolsResult = await runStep("listTools", () =>
      client.listTools(),
    );
    if (!listToolsResult.ok) {
      report.listTools = listToolsResult;
      failureCount += 1;
    } else {
      const names = listToolsResult.result.tools.map((tool) => tool.name);
      report.listTools = {
        ok: true,
        durationMs: listToolsResult.durationMs,
        summary: summarizeList(names),
      };
    }

    const listResourcesResult = await runStep("listResources", () =>
      client.listResources(),
    );
    if (!listResourcesResult.ok) {
      report.listResources = listResourcesResult;
      failureCount += 1;
    } else {
      const names = listResourcesResult.result.resources.map(
        (resource) => resource.uri,
      );
      report.listResources = {
        ok: true,
        durationMs: listResourcesResult.durationMs,
        summary: summarizeList(names),
      };
    }

    const listPromptsResult = await runStep("listPrompts", () =>
      client.listPrompts(),
    );
    if (!listPromptsResult.ok) {
      report.listPrompts = listPromptsResult;
      failureCount += 1;
    } else {
      const names = listPromptsResult.result.prompts.map(
        (prompt) => prompt.name,
      );
      report.listPrompts = {
        ok: true,
        durationMs: listPromptsResult.durationMs,
        summary: summarizeList(names),
      };
    }

    const conversationId = "smoke-conversation";
    const aliasConversationId = "smoke-alias-conversation";

    const imageInput = IMAGE_BASE64
      ? { imageBase64: IMAGE_BASE64, mimeType: IMAGE_MIME }
      : { imageUrl: IMAGE_URL };

    const toolTests = [
      {
        name: "gemini_get_help",
        args: { topic: "overview" },
      },
      {
        name: "gemini_list_models",
        args: { limit: 5 },
      },
      {
        name: "gemini_count_tokens",
        args: { text: "hello world" },
      },
      {
        name: "gemini_count_tokens_batch",
        args: { texts: ["hello", "world"] },
      },
      {
        name: "gemini_embed_text",
        args: { text: "hello world" },
      },
      {
        name: "gemini_embed_text_batch",
        args: { texts: ["hello", "world"] },
      },
      {
        name: "gemini_moderate_text",
        args: { text: "hello world" },
      },
      {
        name: "gemini_conversation_create",
        args: { conversationId },
      },
      {
        name: "gemini_generate_text",
        args: {
          prompt: 'Reply with exactly the string "pong".',
          temperature: 0,
          maxTokens: 64,
          conversationId,
        },
      },
      {
        name: "gemini_generate_text_stream",
        args: {
          prompt: "Stream a short greeting.",
          temperature: 0,
          maxTokens: 64,
        },
        options: { onprogress: true },
      },
      {
        id: "gemini_generate_json_schema",
        name: "gemini_generate_json",
        args: {
          prompt:
            'Return ONLY valid JSON that matches the schema. No markdown or extra text. Output: {"ok": true}.',
          maxTokens: 128,
          temperature: 0,
          jsonSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        },
        retryOnError: 1,
        retryArgs: {
          prompt:
            'Return only minified JSON with no extra characters. Output exactly: {"ok":true}.',
          maxTokens: 256,
        },
      },
      {
        id: "gemini_generate_json_plain",
        name: "gemini_generate_json",
        args: {
          prompt: 'Return JSON {"ok": true}.',
          maxTokens: 64,
          temperature: 0,
        },
      },
      {
        name: "gemini_analyze_image",
        args: {
          prompt:
            'Return one word describing the image. If unsure, return "unknown".',
          maxTokens: 128,
          temperature: 0,
          ...imageInput,
        },
      },
      {
        name: "gemini_conversation_list",
        args: { limit: 10 },
      },
      {
        name: "gemini_conversation_export",
        args: { conversationId },
      },
      {
        name: "gemini_conversation_reset",
        args: { conversationId },
      },
      {
        name: "gemini_code_review",
        args: {
          request: "Review for obvious issues and inconsistencies.",
          paths: ["src/tools/generateText.ts"],
        },
      },
      {
        name: "gemini_code_fix",
        args: {
          request: "Propose a small improvement without applying it.",
          paths: ["src/tools/generateText.ts"],
        },
      },
      {
        name: "llm_generate_text",
        args: {
          prompt: 'Reply with exactly the string "pong".',
          temperature: 0,
          maxTokens: 64,
          conversationId: aliasConversationId,
        },
      },
      {
        name: "llm_generate_text_stream",
        args: {
          prompt: "Stream a short greeting.",
          temperature: 0,
          maxTokens: 64,
        },
        options: { onprogress: true },
      },
      {
        name: "llm_generate_json",
        args: {
          prompt:
            'Return ONLY valid JSON that matches the schema. No markdown or extra text. Output: {"ok": true}.',
          maxTokens: 128,
          temperature: 0,
          jsonSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        },
        retryOnError: 1,
        retryArgs: {
          prompt:
            'Return only minified JSON with no extra characters. Output exactly: {"ok":true}.',
          maxTokens: 256,
        },
      },
      {
        name: "llm_analyze_image",
        args: {
          prompt:
            'Return one word describing the image. If unsure, return "unknown".',
          maxTokens: 128,
          temperature: 0,
          ...imageInput,
        },
      },
      {
        name: "llm_embed_text",
        args: { text: "hello world" },
      },
      {
        name: "llm_embed_text_batch",
        args: { texts: ["hello", "world"] },
      },
      {
        name: "llm_count_tokens",
        args: { text: "hello world" },
      },
      {
        name: "llm_count_tokens_batch",
        args: { texts: ["hello", "world"] },
      },
      {
        name: "llm_list_models",
        args: { filter: "all", limit: 5 },
      },
      {
        name: "llm_moderate_text",
        args: { text: "hello world" },
      },
      {
        name: "llm_conversation_create",
        args: { conversationId: aliasConversationId },
      },
      {
        name: "llm_conversation_list",
        args: { limit: 10 },
      },
      {
        name: "llm_conversation_export",
        args: { conversationId: aliasConversationId },
      },
      {
        name: "llm_conversation_reset",
        args: { conversationId: aliasConversationId },
      },
    ];

    for (const test of toolTests) {
      trace(`tool ${test.name}`);
      const key = test.id ?? test.name;
      const { step, attempts, durationMs } = await runToolWithRetry(
        client,
        test,
      );
      report.tools[key] = step.ok
        ? {
            ok: true,
            durationMs,
            attempts,
            ...step.result,
          }
        : { ...step, durationMs, attempts };
      if (!step.ok) failureCount += 1;
      if (step.ok && step.result.summary.isError) failureCount += 1;
    }

    const resourceTests = [
      "usage://stats",
      "conversation://list",
      "conversation://current",
      `conversation://history/${conversationId}`,
      "gemini://capabilities",
      "gemini://models",
      "gemini://model-capabilities",
      "gemini://model/gemini-2.5-flash",
      "llm://model-capabilities",
      "gemini://help/usage",
      "gemini://help/parameters",
      "gemini://help/examples",
    ];

    for (const uri of resourceTests) {
      trace(`resource ${uri}`);
      const step = await runStep(uri, async () => {
        const result = await client.readResource({ uri });
        const contents = Array.isArray(result.contents) ? result.contents : [];
        const preview = truncate(contents[0]?.text ?? "", 200);
        return {
          contentItems: contents.length,
          preview,
        };
      });
      report.resources[uri] = step;
      if (!step.ok) failureCount += 1;
    }
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
    if (context.close) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
    finalizeAttempt(attempt, context);
  }

  report.summary = {
    ok: failureCount === 0,
    failures: failureCount,
  };
  if (attempt.debug) report.debug = attempt.debug;

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failureCount > 0) {
    process.exitCode = 1;
  }
}


main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: truncate(message), timestamp: new Date().toISOString() }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
