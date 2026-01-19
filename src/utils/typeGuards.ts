/**
 * Shared type guard utilities.
 * Centralized to avoid duplication across the codebase.
 */

/**
 * Type guard to check if a value is a plain object (not null, not array).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safely converts a value to a trimmed string, or returns undefined.
 */
export function toTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Safely converts a value to a finite number, or returns undefined.
 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
