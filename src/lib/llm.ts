/**
 * src/lib/llm.ts — единая точка вызова текстового LLM для self-hosted
 * топологии Conditera (Supabase + n8n + Ollama в Docker).
 *
 * Порядок провайдеров задаётся в src/lib/ai-config.ts (env-параметры,
 * по умолчанию: Ollama → z-ai-web-dev-sdk):
 *   1) Ollama  — если задан OLLAMA_BASE_URL (например http://127.0.0.1:11434
 *                или http://ollama:11434 внутри docker-сети). Модель —
 *                OLLAMA_MODEL (по умолчанию llama3.2).
 *   2) z-ai-web-dev-sdk — платформенный провайдер (если модуль доступен).
 *
 * Сэмплинг (AI_TEMPERATURE, AI_MAX_TOKENS) применяется к обоим провайдерам.
 *
 * Возвращает null при недоступности всех провайдеров — вызывающий роут
 * применяет свой fallback (как и раньше). Fail-safe: сетевые ошибки,
 * таймауты и некорректные ответы проглатываются с логом, приложение
 * продолжает работать.
 *
 * Полный список переменных окружения — см. src/lib/ai-config.ts.
 * Эффективные значения можно посмотреть через GET /api/ai/config (admin-only).
 */

import { getAiAgentConfig } from "@/lib/ai-config";
import type { AiProvider } from "@/lib/ai-config";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  provider: "ollama" | "zai";
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Ollama: POST {base}/api/chat — OpenAI-совместимый по смыслу контракт
 * (messages + stream:false + options). Возвращает текст и счётчики токенов
 * (prompt_eval_count / eval_count — оценка Ollama).
 */
async function chatViaOllama(messages: LlmMessage[]): Promise<LlmResult | null> {
  const cfg = getAiAgentConfig();
  const base = cfg.ollama.baseUrl;
  if (!base) return null;
  const model = cfg.ollama.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.ollama.timeoutMs);
  try {
    const options: Record<string, number> = { temperature: cfg.zai.temperature };
    if (cfg.zai.maxTokens !== null) options.num_predict = cfg.zai.maxTokens;
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, options }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] Ollama HTTP ${res.status} (model=${model})`);
      return null;
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = data?.message?.content?.trim() || "";
    if (!text) {
      console.warn("[llm] Ollama returned empty content");
      return null;
    }
    return {
      text,
      model,
      provider: "ollama",
      inputTokens: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
      outputTokens: typeof data.eval_count === "number" ? data.eval_count : null,
    };
  } catch (err) {
    console.warn("[llm] Ollama unavailable:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Платформенный провайдер z-ai-web-dev-sdk (динамический импорт —
 * не ломает build, если SDK не установлен). temperature/max_tokens —
 * стандартные OpenAI-совместимые параметры сэмплинга.
 */
async function chatViaZai(messages: LlmMessage[]): Promise<LlmResult | null> {
  const cfg = getAiAgentConfig();
  try {
    const ZAIModule = (await import("z-ai-web-dev-sdk").catch(() => null)) as any;
    if (!ZAIModule || !(ZAIModule.create || ZAIModule.default?.create)) return null;
    const ZAI = ZAIModule as any;
    const zai = await ZAI.create();
    const sampling: Record<string, unknown> = { temperature: cfg.zai.temperature };
    if (cfg.zai.maxTokens !== null) sampling.max_tokens = cfg.zai.maxTokens;
    const completion = await zai.chat.completions.create({ messages, ...sampling });
    const text = completion?.choices?.[0]?.message?.content || "";
    if (!text) return null;
    return {
      text,
      model: cfg.zai.model,
      provider: "zai",
      inputTokens: completion?.usage?.prompt_tokens ?? null,
      outputTokens: completion?.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    console.warn("[llm] z-ai SDK unavailable:", (err as Error).message);
    return null;
  }
}

const PROVIDER_FN: Record<AiProvider, (m: LlmMessage[]) => Promise<LlmResult | null>> = {
  ollama: chatViaOllama,
  zai: chatViaZai,
};

/**
 * Главная точка входа: обход провайдеров в порядке AI_PROVIDER_ORDER
 * (default: Ollama → z-ai) до первого успеха.
 * Вызывающий роут обрабатывает null своим fallback-ответом.
 */
export async function chatComplete(messages: LlmMessage[]): Promise<LlmResult | null> {
  const { order } = getAiAgentConfig();
  for (const provider of order) {
    const result = await PROVIDER_FN[provider](messages);
    if (result) return result;
  }
  return null;
}
