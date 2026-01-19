import { describe, expect, it } from "vitest";
import { sortModelsNewToOld } from "./modelSort.js";

describe("sortModelsNewToOld", () => {
  it("sorts best-effort from newer to older", () => {
    const models = [
      {
        name: "models/gemini-2.5-pro-preview-tts",
        version: "gemini-2.5-pro-preview-tts-2025-05-19",
        description: "Gemini 2.5 Pro Preview TTS",
      },
      {
        name: "models/gemini-2.5-pro",
        version: "2.5",
        description: "Stable release (June 17th, 2025) of Gemini 2.5 Pro",
      },
      {
        name: "models/gemini-3-pro-preview",
        version: "3-pro-preview-11-2025",
        description: "Gemini 3 Pro Preview",
      },
      {
        name: "models/gemini-3-pro-image-preview",
        version: "3.0",
        description: "Gemini 3 Pro Image Preview",
      },
      {
        name: "models/gemini-2.0-flash-001",
        version: "2.0",
        description:
          "Stable version of Gemini 2.0 Flash, released in January of 2025.",
      },
      {
        name: "models/deep-research-pro-preview-12-2025",
        version: "deepthink-exp-05-20",
        description:
          "Preview release (December 12th, 2025) of Deep Research Pro",
      },
    ];

    const sorted = sortModelsNewToOld(models).map((model) => model.name);

    expect(sorted).toHaveLength(models.length);
    expect(sorted[0]).toBe("models/deep-research-pro-preview-12-2025");

    expect(sorted.indexOf("models/gemini-3-pro-preview")).toBeLessThan(
      sorted.indexOf("models/gemini-2.5-pro"),
    );
    expect(sorted.indexOf("models/gemini-3-pro-image-preview")).toBeLessThan(
      sorted.indexOf("models/gemini-2.5-pro"),
    );
    expect(sorted.indexOf("models/gemini-2.5-pro")).toBeLessThan(
      sorted.indexOf("models/gemini-2.5-pro-preview-tts"),
    );
    expect(sorted.indexOf("models/gemini-2.5-pro-preview-tts")).toBeLessThan(
      sorted.indexOf("models/gemini-2.0-flash-001"),
    );
  });
});
