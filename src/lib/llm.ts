/**
 * src/lib/llm.ts — единая точка вызова текстового LLM для self-hosted
 * топологии Conditera (Supabase + n8n + Ollama в Docker).
 *
 * Порядок провайдеров:
 *   1) Ollama  — если задан OLLAMA_BASE_URL (например http://127.0.0.1:11434
 *                или http://ollama:11434 внутри docker-сети). Модель —
 *                OLLAMA_MODEL (по умолчанию llama3.2).
 *   2) z-ai-web-dev-sdk — платформенный провайдер (если модуль доступен).
 *
 * Возвращает null при недоступности всех провайдеров — вызывающий роут
 * применяет свой fallback (как и раньше). Fail-safe: сетевые ошибки,
 * таймауты и некорректные ответы проглатываются с логом, приложение
 * продолжает работать.
 *
 * Переменные окружения:
 *   OLLAMA_BASE_URL  — базовый URL Ollama (без /api), необязательно
 *   OLLAMA_MODEL     — имя модели (default: llama3.2)
 *   OLLAMA_TIMEOUT_MS— таймаут запроса (default: 30000)
 */

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

const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);

function ollamaBase(): string | null {
  const raw = (process.env.OLLAMA_BASE_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Ollama: POST {base}/api/chat — OpenAI-совместимый по смыслу контракт
 * (messages + stream:false). Возвращает текст и счётчики токенов
 * (prompt_eval_count / eval_count — оценка Ollama).
 */
async function chatViaOllama(messages: LlmMessage[]): Promise<LlmResult | null> {
  const base = ollamaBase();
  if (!base) return null;
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
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
 * не ломает build, если SDK не установлен).
 */
async function chatViaZai(messages: LlmMessage[]): Promise<LlmResult | null> {
  try {
    const ZAIModule = (await import("z-ai-web-dev-sdk").catch(() => null)) as any;
    if (!ZAIModule || !(ZAIModule.create || ZAIModule.default?.create)) return null;
    const ZAI = ZAIModule as any;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({ messages });
    const text = completion?.choices?.[0]?.message?.content || "";
    if (!text) return null;
    return {
      text,
      model: "glm-4",
      provider: "zai",
      inputTokens: completion?.usage?.prompt_tokens ?? null,
      outputTokens: completion?.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    console.warn("[llm] z-ai SDK unavailable:", (err as Error).message);
    return null;
  }
}

/**
 * Главная точка входа: Ollama → z-ai → null.
 * Вызывающий роут обрабатывает null своим fallback-ответом.
 */
export async function chatComplete(messages: LlmMessage[]): Promise<LlmResult | null> {
  const viaOllama = await chatViaOllama(messages);
  if (viaOllama) return viaOllama;
  return chatViaZai(messages);
}
