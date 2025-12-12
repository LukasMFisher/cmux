import type { ModelConfig } from "./run-simple-anthropic-review";

type SearchParamsRecord = {
  [key: string]: string | string[] | undefined;
};

export const HEATMAP_MODEL_QUERY_KEY = "model";
export const HEATMAP_LANGUAGE_QUERY_KEY = "lang";

// Supported languages for tooltip localization
export const TOOLTIP_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "hi", label: "हिन्दी" },
  { value: "bn", label: "বাংলা" },
  { value: "te", label: "తెలుగు" },
  { value: "mr", label: "मराठी" },
  { value: "ta", label: "தமிழ்" },
  { value: "gu", label: "ગુજરાતી" },
  { value: "kn", label: "ಕನ್ನಡ" },
  { value: "ml", label: "മലയാളം" },
  { value: "pa", label: "ਪੰਜਾਬੀ" },
  { value: "ar", label: "العربية" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "th", label: "ไทย" },
  { value: "id", label: "Bahasa Indonesia" },
] as const;

export type TooltipLanguageValue =
  (typeof TOOLTIP_LANGUAGE_OPTIONS)[number]["value"];

export const DEFAULT_TOOLTIP_LANGUAGE: TooltipLanguageValue = "en";

export function normalizeTooltipLanguage(
  raw: string | null | undefined
): TooltipLanguageValue {
  if (typeof raw !== "string") {
    return DEFAULT_TOOLTIP_LANGUAGE;
  }
  const normalized = raw.trim().toLowerCase();
  const found = TOOLTIP_LANGUAGE_OPTIONS.find(
    (opt) => opt.value.toLowerCase() === normalized
  );
  return found ? found.value : DEFAULT_TOOLTIP_LANGUAGE;
}

export function getLanguageDisplayName(value: TooltipLanguageValue): string {
  const found = TOOLTIP_LANGUAGE_OPTIONS.find((opt) => opt.value === value);
  return found ? found.label : "English";
}

export function parseTooltipLanguageFromUrlSearchParams(
  searchParams: URLSearchParams
): TooltipLanguageValue {
  return normalizeTooltipLanguage(
    searchParams.get(HEATMAP_LANGUAGE_QUERY_KEY)
  );
}
export const HEATMAP_MODEL_FINETUNE_QUERY_VALUE = "finetune";
export const HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE = "cmux-heatmap-1";
export const HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE = "cmux-heatmap-2";
export const HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE = "anthropic-opus-4-5";
export const HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE = "anthropic";
export type HeatmapModelQueryValue =
  | typeof HEATMAP_MODEL_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE
  | typeof HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE;

const LEGACY_HEATMAP_MODEL_PARAM_MAP: Record<string, HeatmapModelQueryValue> = {
  ft0: HEATMAP_MODEL_FINETUNE_QUERY_VALUE,
  ft1: HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE,
};

const FINE_TUNED_OPENAI_MODEL_ID =
  "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-sft:CZW6Lc77";
const FINE_TUNED_OPENAI_DENSE_MODEL_ID =
  "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-dense:CaaqvYVO";
const FINE_TUNED_OPENAI_DENSE_V2_MODEL_ID =
  "ft:gpt-4.1-2025-04-14:lawrence:cmux-heatmap-dense-4-1:CahKn54r";
const ANTHROPIC_OPUS_41_MODEL_ID = "claude-opus-4-1-20250805";
const ANTHROPIC_OPUS_45_MODEL_ID = "claude-opus-4-5";

function createFineTunedOpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_MODEL_ID,
  };
}

function createFineTunedDenseOpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_DENSE_MODEL_ID,
  };
}

function createFineTunedDenseV2OpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_DENSE_V2_MODEL_ID,
  };
}

function createAnthropicOpus41Config(): ModelConfig {
  return {
    provider: "anthropic",
    model: ANTHROPIC_OPUS_41_MODEL_ID,
  };
}

function createAnthropicOpus45Config(): ModelConfig {
  return {
    provider: "anthropic",
    model: ANTHROPIC_OPUS_45_MODEL_ID,
  };
}

export function getDefaultHeatmapModelConfig(): ModelConfig {
  return createAnthropicOpus45Config();
}

export function getHeatmapModelConfigForSelection(
  selection: HeatmapModelQueryValue
): ModelConfig {
  if (selection === HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE) {
    return createAnthropicOpus45Config();
  }
  if (selection === HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE) {
    return createFineTunedDenseV2OpenAiConfig();
  }
  if (selection === HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE) {
    return createAnthropicOpus41Config();
  }
  if (selection === HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE) {
    return createFineTunedDenseOpenAiConfig();
  }
  return createFineTunedOpenAiConfig();
}

export function normalizeHeatmapModelQueryValue(
  raw: string | null | undefined
): HeatmapModelQueryValue {
  if (typeof raw !== "string") {
    return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE) {
    return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE) {
    return HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_FINETUNE_QUERY_VALUE;
  }
  return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
}

function extractRecordValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function resolveModelSelectionFromRecord(
  searchParams: SearchParamsRecord
): HeatmapModelQueryValue {
  for (const paramKey of Object.keys(LEGACY_HEATMAP_MODEL_PARAM_MAP)) {
    if (paramKey in searchParams) {
      return LEGACY_HEATMAP_MODEL_PARAM_MAP[paramKey];
    }
  }
  const raw = extractRecordValue(searchParams[HEATMAP_MODEL_QUERY_KEY]);
  return normalizeHeatmapModelQueryValue(raw ?? null);
}

function resolveModelSelectionFromUrlSearchParams(
  searchParams: URLSearchParams
): HeatmapModelQueryValue {
  for (const paramKey of Object.keys(LEGACY_HEATMAP_MODEL_PARAM_MAP)) {
    if (searchParams.has(paramKey)) {
      return LEGACY_HEATMAP_MODEL_PARAM_MAP[paramKey];
    }
  }
  return normalizeHeatmapModelQueryValue(
    searchParams.get(HEATMAP_MODEL_QUERY_KEY)
  );
}

export function parseModelConfigFromRecord(
  searchParams: SearchParamsRecord
): ModelConfig | undefined {
  const selection = resolveModelSelectionFromRecord(searchParams);
  return getHeatmapModelConfigForSelection(selection);
}

export function parseModelConfigFromUrlSearchParams(
  searchParams: URLSearchParams
): ModelConfig | undefined {
  const selection = resolveModelSelectionFromUrlSearchParams(searchParams);
  return getHeatmapModelConfigForSelection(selection);
}
