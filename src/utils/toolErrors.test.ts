import { describe, expect, it } from "vitest";
import { formatToolError } from "./toolErrors.js";

describe("formatToolError", () => {
  it("surfaces generic error messages (redacted) instead of a generic placeholder", () => {
    expect(formatToolError(new Error("Failed to fetch image (403)"))).toEqual({
      message: "Failed to fetch image (403)",
    });

    expect(
      formatToolError(new Error("Authorization: Bearer secret-token")),
    ).toEqual({
      message: "Authorization: Bearer [redacted]",
    });
  });
});

