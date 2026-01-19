import { isRecord, toTrimmedString } from "./typeGuards.js";

function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

const MONTH_PREFIX_TO_NUMBER: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseDateKeyFromText(text: string): number {
  const candidates: number[] = [];

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    candidates.push(
      Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]),
    );
  }

  const monthYearNumeric = text.match(/\b(\d{1,2})-(20\d{2})\b/);
  if (monthYearNumeric) {
    candidates.push(
      Number(monthYearNumeric[2]) * 10000 + Number(monthYearNumeric[1]) * 100,
    );
  }

  const monthDayYear = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(20\d{2})\b/i,
  );
  if (monthDayYear) {
    const month =
      MONTH_PREFIX_TO_NUMBER[monthDayYear[1].slice(0, 3).toLowerCase()] ?? 0;
    candidates.push(
      Number(monthDayYear[3]) * 10000 + month * 100 + Number(monthDayYear[2]),
    );
  }

  const monthYear = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:of\s+)?(20\d{2})\b/i,
  );
  if (monthYear) {
    const month =
      MONTH_PREFIX_TO_NUMBER[monthYear[1].slice(0, 3).toLowerCase()] ?? 0;
    candidates.push(Number(monthYear[2]) * 10000 + month * 100);
  }

  return candidates.length ? Math.max(...candidates) : 0;
}

type ParsedSemanticVersion = {
  family: string;
  major: number;
  minor: number;
  patch: number;
};

function parseSemanticVersion(name: string): ParsedSemanticVersion {
  const normalized = stripModelsPrefix(name.trim());
  const family = normalized.split("-")[0]?.toLowerCase() ?? "";
  const match = normalized.match(/^([a-z0-9]+)-(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) return { family, major: 0, minor: 0, patch: 0 };
  return {
    family: match[1].toLowerCase(),
    major: Number(match[2]),
    minor: Number(match[3] ?? 0),
    patch: Number(match[4] ?? 0),
  };
}

type SortKey = {
  normalizedName: string;
  family: string;
  major: number;
  minor: number;
  patch: number;
  dateKey: number;
};

function buildSortKey(model: unknown): SortKey {
  const record = isRecord(model) ? model : undefined;
  const rawName = record ? toTrimmedString(record.name) : undefined;
  const normalizedName = rawName ? stripModelsPrefix(rawName) : "";

  const version = record ? toTrimmedString(record.version) : undefined;
  const description = record ? toTrimmedString(record.description) : undefined;

  const semantic = parseSemanticVersion(normalizedName);
  const dateKey = Math.max(
    parseDateKeyFromText(normalizedName),
    version ? parseDateKeyFromText(version) : 0,
    description ? parseDateKeyFromText(description) : 0,
  );

  return {
    normalizedName,
    family: semantic.family,
    major: semantic.major,
    minor: semantic.minor,
    patch: semantic.patch,
    dateKey,
  };
}

export function sortModelsNewToOld<T>(models: readonly T[]): T[] {
  const keyed = models.map((model, index) => {
    const key = buildSortKey(model as unknown);
    return { model, index, ...key };
  });

  const groupMaxDate = new Map<string, number>();
  for (const entry of keyed) {
    const group = `${entry.family}|${entry.major}|${entry.minor}`;
    const current = groupMaxDate.get(group) ?? 0;
    if (entry.dateKey > current) groupMaxDate.set(group, entry.dateKey);
  }

  const withEffectiveDate = keyed.map((entry) => {
    const group = `${entry.family}|${entry.major}|${entry.minor}`;
    const effectiveDateKey =
      entry.dateKey > 0 ? entry.dateKey : (groupMaxDate.get(group) ?? 0);
    return { ...entry, effectiveDateKey };
  });

  withEffectiveDate.sort((a, b) => {
    if (a.effectiveDateKey !== b.effectiveDateKey)
      return b.effectiveDateKey - a.effectiveDateKey;
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    if (a.patch !== b.patch) return b.patch - a.patch;
    const nameDiff = a.normalizedName.localeCompare(b.normalizedName);
    if (nameDiff !== 0) return nameDiff;
    return a.index - b.index;
  });

  return withEffectiveDate.map((entry) => entry.model);
}
