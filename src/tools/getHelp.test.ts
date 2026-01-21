import { describe, expect, it } from "vitest";
import {
  HELP_EXAMPLES,
  HELP_PARAMETERS,
  HELP_USAGE,
} from "../resources/helpContent.js";
import { createGetHelpHandler } from "./getHelp.js";

describe("gemini_get_help", () => {
  it("returns usage by default", async () => {
    const handler = createGetHelpHandler();
    const result = await handler({});

    expect(result.content[0]?.text).toBe(HELP_USAGE);
  });

  it("returns parameters and examples content", async () => {
    const handler = createGetHelpHandler();
    const paramsResult = await handler({ topic: "parameters" });
    const examplesResult = await handler({ topic: "examples" });

    expect(paramsResult.content[0]?.text).toBe(HELP_PARAMETERS);
    expect(examplesResult.content[0]?.text).toBe(HELP_EXAMPLES);
  });

  it("returns tool list help", async () => {
    const handler = createGetHelpHandler();
    const result = await handler({ topic: "tools" });

    expect(result.content[0]?.text).toContain("gemini_generate_text");
    expect(result.content[0]?.text).toContain("llm_generate_text");
  });
});
