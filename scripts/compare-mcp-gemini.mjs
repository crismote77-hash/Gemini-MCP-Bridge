import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAX_OUTPUT_CHARS = 1600;
const PLACEHOLDER_KEY = "DUMMY_GEMINI_API_KEY";

function truncateOutput(text, limit = MAX_OUTPUT_CHARS) {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
}

function stringifyOutput(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeListResult(testName, result) {
  if (!result) return result;
  if (testName === "listTools" && Array.isArray(result.tools)) {
    return result.tools.map((tool) => tool.name);
  }
  if (testName === "listResources" && Array.isArray(result.resources)) {
    return result.resources.map((resource) => resource.uri);
  }
  if (testName === "listPrompts" && Array.isArray(result.prompts)) {
    return result.prompts.map((prompt) => prompt.name);
  }
  return result;
}

function summarizeToolResult(result) {
  if (!result) return result;
  return {
    isError: result.isError ?? false,
    content: result.content,
    structuredContent: result.structuredContent,
  };
}

async function runTest(testName, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const summary = summarizeListResult(testName, result);
    const output = truncateOutput(stringifyOutput(summary));
    return { ok: true, durationMs, output };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, durationMs, output: "", error: message };
  }
}

async function runToolTest(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const output = truncateOutput(stringifyOutput(summarizeToolResult(result)));
    return { ok: true, durationMs, output };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, durationMs, output: "", error: message };
  }
}

async function runSuite(config) {
  const results = {};
  let client;
  let transport;
  let connectError;

  try {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: process.cwd(),
      env: {
        GEMINI_API_KEY: config.geminiApiKey,
      },
    });
    client = new Client({ name: "mcp-compare-harness", version: "0.1.0" });
    await client.connect(transport);
  } catch (error) {
    connectError = error instanceof Error ? error.message : String(error);
  }

  const tests = [
    { name: "listTools", run: () => client.listTools() },
    { name: "listResources", run: () => client.listResources() },
    { name: "listPrompts", run: () => client.listPrompts() },
    {
      name: "helpOverview",
      run: () =>
        client.callTool({
          name: config.toolMap.get_help,
          arguments: { topic: "overview" },
        }),
      tool: true,
    },
    {
      name: "listModels",
      run: () =>
        client.callTool({
          name: config.toolMap.list_models,
          arguments: config.listModelsArgs,
        }),
      tool: true,
    },
    {
      name: "countTokens",
      run: () =>
        client.callTool({
          name: config.toolMap.count_tokens,
          arguments: { text: "hello world" },
        }),
      tool: true,
    },
    {
      name: "embedText",
      run: () =>
        client.callTool({
          name: config.toolMap.embed_text,
          arguments: { text: "hello world", model: "text-embedding-004" },
        }),
      tool: true,
    },
    {
      name: "generateText",
      run: () =>
        client.callTool({
          name: config.toolMap.generate_text,
          arguments: {
            prompt: 'Reply with exactly the string "pong".',
            model: "gemini-2.5-flash",
            temperature: 0,
            maxTokens: 8,
          },
        }),
      tool: true,
    },
    {
      name: "analyzeImage",
      run: () =>
        client.callTool({
          name: config.toolMap.analyze_image,
          arguments: {
            prompt: "Validation only.",
            imageBase64: "AA==",
            mimeType: "image/png",
          },
        }),
      tool: true,
    },
  ];

  if (connectError) {
    for (const test of tests) {
      results[test.name] = {
        ok: false,
        durationMs: 0,
        output: "",
        error: `connect failed: ${connectError}`,
      };
    }
    return results;
  }

  try {
    for (const test of tests) {
      results[test.name] = test.tool ? await runToolTest(test.run) : await runTest(test.name, test.run);
    }
  } finally {
    if (client) {
      await client.close();
    } else if (transport) {
      await transport.close();
    }
  }

  return results;
}

async function main() {
  const envKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const usingPlaceholder = !envKey;
  const geminiApiKey = envKey ?? PLACEHOLDER_KEY;

  const report = {
    timestamp: new Date().toISOString(),
    notes: usingPlaceholder
      ? ["GEMINI_API_KEY/GOOGLE_API_KEY not set; using placeholder key for both servers."]
      : [],
    geminiApiKeySource: envKey ? (process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GOOGLE_API_KEY") : "placeholder",
    results: {},
  };

  const servers = [
    {
      id: "bridge",
      command: "node",
      args: ["dist/index.js", "--stdio"],
      geminiApiKey,
      toolMap: {
        generate_text: "gemini_generate_text",
        analyze_image: "gemini_analyze_image",
        embed_text: "gemini_embed_text",
        count_tokens: "gemini_count_tokens",
        list_models: "gemini_list_models",
        get_help: "gemini_get_help",
      },
      listModelsArgs: { limit: 5 },
    },
    {
      id: "aliargun",
      command: "node",
      args: ["external/mcp-server-gemini/dist/enhanced-stdio-server.js"],
      geminiApiKey,
      toolMap: {
        generate_text: "generate_text",
        analyze_image: "analyze_image",
        embed_text: "embed_text",
        count_tokens: "count_tokens",
        list_models: "list_models",
        get_help: "get_help",
      },
      listModelsArgs: { filter: "all" },
    },
  ];

  for (const server of servers) {
    report.results[server.id] = await runSuite(server);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: message, timestamp: new Date().toISOString() }, null, 2)}\n`,
  );
});
