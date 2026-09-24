/**
 * Embeddings-based FAQ matching через @xenova/transformers.
 *
 * Лёгкий ML-движок (~5MB), работает в Node.js и браузере без API-ключей.
 * Модель: Xenova/paraphrase-multilingual-MiniLM-L12-v2 — мультиязычная,
 * поддерживает русский и английский, ~120MB в кэше.
 *
 * УСТАНОВКА (опционально):
 *   npm install @xenova/transformers
 *
 * После установки embeddings-матчер автоматически активируется.
 * Если пакет не установлен — fallback на keyword + Jaccard (chat-faq-ml.ts).
 *
 * Преимущества над keyword-matcher:
 *  - Понимает синонимы ("когда привезут" vs "сроки доставки")
 *  - Понимает парафраз ("хочу вернуть деньги" vs "оформить возврат")
 *  - Мультиязычность из коробки
 *
 * Недостатки:
 *  - 120MB модель в кэше (загружается один раз)
 *  - Первый запрос ~3-5 секунд (загрузка модели)
 *  - Последующие ~50-100ms на запрос
 *
 * Безопасность:
 *   • Lazy loading через dynamic import — пакет опционален.
 *   • Все ошибки логируются, не бросают — fallback на keyword matcher.
 *   • Type-safe interfaces, без `as any` кастов.
 */

import { matchFaqMl, type MlMatchResult } from "./chat-faq-ml";
import { FAQ_TOPICS } from "./chat-faq";
import { FAQ_TOPICS_EN } from "./chat-faq-en";

// Extend MlMatchResult с дополнительным методом "embedding" — этот файл
// использует семантический матчер, который не входит в стандартные методы.
type EmbeddingMatchResult = Omit<MlMatchResult, "method"> & {
  method: "keyword" | "jaccard" | "fuzzy" | "stem" | "embedding";
};

// Ленивая загрузка @xenova/transformers — если не установлен, fallback.
// Используем unknown, т.к. типы @xenova/transformers могут не быть установлены.
type ExtractorFn = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
type PipelineFn = (task: string, model: string) => Promise<ExtractorFn>;

let pipeline: PipelineFn | null = null;
let extractor: ExtractorFn | null = null;
let isInitialized = false;
let initError: string | null = null;

interface Embedding {
  topicId: string;
  vector: Float32Array;
  lang: "ru" | "en";
}

const EMBEDDINGS_CACHE = new Map<"ru" | "en", Embedding[]>();
const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * Инициализация: загрузка модели и пред-вычисление embeddings для всех FAQ тем.
 * Вызывается один раз при первом запросе.
 */
async function initialize(): Promise<boolean> {
  if (isInitialized) return extractor !== null;
  isInitialized = true;

  try {
    // Динамический import через new Function — Turbopack не резолвит на этапе сборки
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<{
      pipeline: PipelineFn;
    }>;
    const transformers = await dynamicImport("@xenova/transformers");
    pipeline = transformers.pipeline;
    console.info("[embeddings] Loading model (first time, ~120MB)...");
    extractor = await pipeline("feature-extraction", MODEL_NAME);
    console.info("[embeddings] Model loaded");

    // Пред-вычисляем embeddings для всех FAQ тем (RU + EN)
    for (const lang of ["ru", "en"] as const) {
      const topics = lang === "ru" ? FAQ_TOPICS : FAQ_TOPICS_EN;
      const embeddings: Embedding[] = [];

      for (const topic of topics) {
        // Комбинируем keywords + answer для лучшего семантического охвата
        const text = `${topic.keywords.join(" ")} ${topic.answer.slice(0, 200)}`;
        const vector = await computeEmbedding(text);
        embeddings.push({ topicId: topic.id, vector, lang });
      }

      EMBEDDINGS_CACHE.set(lang, embeddings);
    }
    console.info(`[embeddings] Pre-computed ${EMBEDDINGS_CACHE.size} topic embeddings`);
    return true;
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
    console.warn(`[embeddings] Failed to initialize: ${initError}`);
    console.warn("[embeddings] Install @xenova/transformers to enable: npm i @xenova/transformers");
    return false;
  }
}

async function computeEmbedding(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error("Extractor not initialized");
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return output.data;
}

/**
 * Cosine similarity между двумя векторами.
 * Возвращает 0 при mismatched length или zero norm.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embeddings-based matcher.
 * Возвращает null, если пакет не установлен или модель не загружена.
 */
export async function matchFaqEmbeddings(
  message: string,
  lang: "ru" | "en" = "ru",
  threshold: number = 0.55
): Promise<EmbeddingMatchResult | null> {
  const ok = await initialize();
  if (!ok || !extractor) return null;

  try {
    const messageEmbedding = await computeEmbedding(message);
    const cache = EMBEDDINGS_CACHE.get(lang) || [];

    let best: EmbeddingMatchResult | null = null;
    for (const emb of cache) {
      const score = cosineSimilarity(messageEmbedding, emb.vector);
      if (score > threshold && (!best || score > best.score)) {
        const topic =
          lang === "ru"
            ? FAQ_TOPICS.find((t) => t.id === emb.topicId)
            : FAQ_TOPICS_EN.find((t) => t.id === emb.topicId);
        if (topic) {
          best = {
            topic: topic as unknown as EmbeddingMatchResult["topic"],
            score,
            method: "embedding",
          };
        }
      }
    }
    return best;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[embeddings] matchFaqEmbeddings failed:", msg);
    return null;
  }
}

/**
 * Гибридный matcher: сначала embeddings (если доступны), потом fallback на ML.
 */
export async function matchFaqHybrid(
  message: string,
  lang: "ru" | "en" = "ru"
): Promise<EmbeddingMatchResult | null> {
  // 1. Попробовать embeddings (если @xenova/transformers установлен)
  const embeddingResult = await matchFaqEmbeddings(message, lang);
  if (embeddingResult) return embeddingResult;

  // 2. Fallback на keyword + Jaccard (только для RU)
  if (lang === "ru") {
    const mlResult = await matchFaqMl(message);
    if (mlResult) {
      return { ...mlResult, method: mlResult.method } as EmbeddingMatchResult;
    }
    return null;
  }

  // 3. Fallback на EN keyword search
  const lower = message.toLowerCase();
  let bestEn: { topic: (typeof FAQ_TOPICS_EN)[number]; score: number } | null = null;
  for (const topic of FAQ_TOPICS_EN) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) score += kw.length > 5 ? 2 : 1;
    }
    if (score > 0 && (!bestEn || score > bestEn.score)) {
      bestEn = { topic, score };
    }
  }
  return bestEn
    ? {
        topic: bestEn.topic as unknown as EmbeddingMatchResult["topic"],
        score: bestEn.score / 3,
        method: "keyword",
      }
    : null;
}

/**
 * Проверка: установлен ли @xenova/transformers.
 */
export function isEmbeddingsAvailable(): boolean {
  return isInitialized && extractor !== null;
}

/**
 * Статус инициализации (для отладки).
 */
export function getEmbeddingsStatus(): {
  initialized: boolean;
  available: boolean;
  error: string | null;
  cacheSize: number;
} {
  return {
    initialized: isInitialized,
    available: extractor !== null,
    error: initError,
    cacheSize: EMBEDDINGS_CACHE.size,
  };
}
