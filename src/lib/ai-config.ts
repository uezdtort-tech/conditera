/**
 * src/lib/ai-config.ts — единая конфигурация AI-агента Conditera.
 *
 * ВЫНЕСЕНО В ENV (2026-11-18, по поручению владельца): параметры раньше были
 * размазаны по коду (llm.ts — хардкод модели и провайдера; ai-dialogue — свои
 * вызовы SDK). Теперь все настройки читаются из переменных окружения с
 * безопасными дефолтами.
 *
 * Переменные окружения (.env.local / .env):
 *   AI_PROVIDER_ORDER  — порядок провайдеров через запятую: "ollama,zai"
 *                        (default: "ollama,zai"; допустимы только ollama/zai)
 *   OLLAMA_BASE_URL    — базовый URL Ollama без /api (default: не задан → пропускается)
 *   OLLAMA_MODEL       — модель Ollama (default: llama3.2)
 *   OLLAMA_TIMEOUT_MS  — таймаут запроса к Ollama (default: 30000)
 *   AI_ZAI_MODEL       — метка модели платформенного провайдера z-ai-web-dev-sdk
 *                        (default: glm-4; фактическая модель определяется платформой)
 *   AI_TEMPERATURE     — температура сэмплинга 0..2 (default: 0.6)
 *   AI_MAX_TOKENS      — лимит токенов ответа (default: не задан → без лимита)
 *
 * Секретов здесь нет: ключи платформы/токены живут в других переменных и
 * никогда не возвращаются этим модулем.
 */

export type AiProvider = "ollama" | "zai";

export interface AiAgentConfig {
  /** Порядок обхода провайдеров; первый доступный обслуживает запрос */
  order: AiProvider[];
  ollama: {
    baseUrl: string | null;
    model: string;
    timeoutMs: number;
  };
  zai: {
    /** Метка модели для логов/метрик (фактическая модель — на стороне платформы) */
    model: string;
    temperature: number;
    maxTokens: number | null;
  };
}

/** Имена env-ключей — для документации и /api/ai/config */
export const AI_CONFIG_KEYS = {
  order: "AI_PROVIDER_ORDER",
  ollamaBaseUrl: "OLLAMA_BASE_URL",
  ollamaModel: "OLLAMA_MODEL",
  ollamaTimeoutMs: "OLLAMA_TIMEOUT_MS",
  zaiModel: "AI_ZAI_MODEL",
  temperature: "AI_TEMPERATURE",
  maxTokens: "AI_MAX_TOKENS",
} as const;

export const AI_DEFAULTS = {
  order: ["ollama", "zai"] as AiProvider[],
  ollamaModel: "llama3.2",
  ollamaTimeoutMs: 30000,
  zaiModel: "glm-4",
  temperature: 0.6,
} as const;

function clampTemperature(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return AI_DEFAULTS.temperature;
  return Math.min(2, Math.max(0, raw));
}

/**
 * Прочитать эффективную конфигурацию AI-агента из окружения.
 * Вызывается на каждый запрос — чтение process.env дёшево, зато правки
 * .env.local подхватываются перезапуском dev-сервера без правок кода.
 */
export function getAiAgentConfig(): AiAgentConfig {
  const orderRaw = (process.env.AI_PROVIDER_ORDER || "ollama,zai")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AiProvider => s === "ollama" || s === "zai");

  const ollamaTimeoutRaw = Number(process.env.OLLAMA_TIMEOUT_MS);
  const maxTokensRaw = Number(process.env.AI_MAX_TOKENS);
  const baseUrlRaw = (process.env.OLLAMA_BASE_URL || "").trim().replace(/\/+$/, "");

  return {
    order: orderRaw.length ? orderRaw : [...AI_DEFAULTS.order],
    ollama: {
      baseUrl: baseUrlRaw || null,
      model: (process.env.OLLAMA_MODEL || "").trim() || AI_DEFAULTS.ollamaModel,
      timeoutMs:
        Number.isFinite(ollamaTimeoutRaw) && ollamaTimeoutRaw > 0
          ? ollamaTimeoutRaw
          : AI_DEFAULTS.ollamaTimeoutMs,
    },
    zai: {
      model: (process.env.AI_ZAI_MODEL || "").trim() || AI_DEFAULTS.zaiModel,
      temperature: clampTemperature(process.env.AI_TEMPERATURE ? Number(process.env.AI_TEMPERATURE) : undefined),
      maxTokens:
        Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? Math.floor(maxTokensRaw) : null,
    },
  };
}
