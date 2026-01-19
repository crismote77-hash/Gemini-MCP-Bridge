export type CuratedModelFeature =
  | "thinking"
  | "vision"
  | "grounding"
  | "json_mode"
  | "system_instructions"
  | "function_calling";

export type CuratedModelFilter = "all" | "thinking" | "vision" | "grounding" | "json_mode";

export type CuratedModel = {
  name: string;
  description: string;
  features: CuratedModelFeature[];
  contextWindow?: number;
  thinking?: string;
};

export const CURATED_GEMINI_MODELS: Record<string, CuratedModel> = {
  "gemini-2.5-pro": {
    name: "gemini-2.5-pro",
    description: "High-accuracy Gemini model optimized for complex reasoning.",
    features: ["thinking", "vision", "grounding", "json_mode", "system_instructions", "function_calling"],
    thinking: "supported",
  },
  "gemini-2.5-flash": {
    name: "gemini-2.5-flash",
    description: "Fast, multimodal Gemini model for low-latency tasks.",
    features: ["thinking", "vision", "grounding", "json_mode", "system_instructions", "function_calling"],
    thinking: "supported",
  },
  "gemini-2.5-flash-lite": {
    name: "gemini-2.5-flash-lite",
    description: "Lightweight Gemini model tuned for speed and cost.",
    features: ["vision", "grounding", "json_mode", "system_instructions", "function_calling"],
  },
  "gemini-2.0-flash": {
    name: "gemini-2.0-flash",
    description: "Balanced Gemini model for everyday multimodal workloads.",
    features: ["vision", "grounding", "json_mode", "system_instructions", "function_calling"],
  },
  "gemini-1.5-pro": {
    name: "gemini-1.5-pro",
    description: "Stable Gemini model with strong general-purpose performance.",
    features: ["vision", "grounding", "json_mode", "system_instructions", "function_calling"],
  },
};

export function listCuratedGeminiModels(filter: CuratedModelFilter = "all"): CuratedModel[] {
  const models = Object.values(CURATED_GEMINI_MODELS);
  if (filter === "all") return models;
  return models.filter((model) => model.features.includes(filter));
}
