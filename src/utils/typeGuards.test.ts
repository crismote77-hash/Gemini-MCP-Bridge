import { describe, expect, it } from "vitest";
import { isRecord, toTrimmedString, toFiniteNumber } from "./typeGuards.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({ nested: { value: true } })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("toTrimmedString", () => {
  it("returns trimmed string for non-empty strings", () => {
    expect(toTrimmedString("hello")).toBe("hello");
    expect(toTrimmedString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty or whitespace-only strings", () => {
    expect(toTrimmedString("")).toBeUndefined();
    expect(toTrimmedString("   ")).toBeUndefined();
  });

  it("returns undefined for non-strings", () => {
    expect(toTrimmedString(123)).toBeUndefined();
    expect(toTrimmedString(null)).toBeUndefined();
    expect(toTrimmedString(undefined)).toBeUndefined();
    expect(toTrimmedString({})).toBeUndefined();
  });
});

describe("toFiniteNumber", () => {
  it("returns the number for finite numbers", () => {
    expect(toFiniteNumber(123)).toBe(123);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-5.5)).toBe(-5.5);
  });

  it("returns undefined for non-finite numbers", () => {
    expect(toFiniteNumber(Infinity)).toBeUndefined();
    expect(toFiniteNumber(-Infinity)).toBeUndefined();
    expect(toFiniteNumber(NaN)).toBeUndefined();
  });

  it("parses valid numeric strings", () => {
    expect(toFiniteNumber("123")).toBe(123);
    expect(toFiniteNumber("  456  ")).toBe(456);
    expect(toFiniteNumber("-7.5")).toBe(-7.5);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(toFiniteNumber("abc")).toBeUndefined();
    expect(toFiniteNumber("")).toBeUndefined();
    expect(toFiniteNumber("   ")).toBeUndefined();
  });

  it("returns undefined for non-numbers/non-strings", () => {
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
    expect(toFiniteNumber({})).toBeUndefined();
  });
});
