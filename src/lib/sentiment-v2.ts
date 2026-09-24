/**
 * Sentiment v2: embeddings через @xenova/transformers.
 *
 * Заменяет лексический подход (sentiment.ts) на семантический.
 * Использует модель Xenova/paraphrase-multilingual-MiniLM-L12-v2
 * для получения embeddings и cosine similarity с эталонными
 * негативными/позитивными фразами.
 *
 * Преимущества:
 *  - Понимает синонимы и парафразы
 *  - Работает с русским и английским
 *  - Не зависит от точного совпадения слов
 *
 * Недостатки:
 *  - 120MB модель в кэше
 *  - Первый запрос ~3-5 секунд (загрузка)
 *  - Последующие ~50-100ms
 *
 * УСТАНОВКА (опционально):
 *   npm install @xenova/transformers
 *
 * Если пакет не установлен — fallback на sentiment.ts (лексический).
 */

import { analyzeSentiment, SentimentResult } from "./sentiment";

// Эталонные фразы для каждого класса (для cosine similarity)
const NEGATIVE_REFERENCES = [
  "торт ужасный невкусный испорченный",
  "кондитер обманул деньги не вернул мошенники",
  "привезли битый торт возмутительно",
  "хамство грубость игнорируют поддержку",
  "жалоба в роспотребнадзор прокуратура суд",
  "никогда не закажу снова разочарован",
  "плохое качество отвратительный сервис",
  "опоздали доставили холодный испорченный",
];

const POSITIVE_REFERENCES = [
  "отличный торт очень вкусно спасибо",
  "замечательная работа красиво и аккуратно",
  "быстрая доставка свежий торт рекомендую",
  "очень доволен заказом превзошло ожидания",
  "спасибо за прекрасный торт на день рождения",
  "вкусно красиво вовремя рекомендую всем",
];

let pipeline: any = null;
let extractor: any = null;
let isInitialized = false;
let initError: string | null = null;

let negativeEmbeddings: Float32Array[] = [];
let positiveEmbeddings: Float32Array[] = [];

const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

async function initialize(): Promise<boolean> {
  if (isInitialized) return extractor !== null;
  isInitialized = true;

  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
    const transformers = await dynamicImport("@xenova/transformers");
    pipeline = transformers.pipeline;
    console.info("[sentiment-v2] Loading model (first time, ~120MB)...");
    extractor = await pipeline("feature-extraction", MODEL_NAME);

    // Пред-вычисляем embeddings для эталонных фраз
    for (const text of NEGATIVE_REFERENCES) {
      negativeEmbeddings.push(await computeEmbedding(text));
    }
    for (const text of POSITIVE_REFERENCES) {
      positiveEmbeddings.push(await computeEmbedding(text));
    }

    console.info(
      `[sentiment-v2] Model loaded, ${negativeEmbeddings.length} negative + ${positiveEmbeddings.length} positive references`
    );
    return true;
  } catch (e) {
    initError = (e as Error).message;
    console.warn(`[sentiment-v2] Failed to initialize: ${initError}`);
    console.warn(`[sentiment-v2] Install @xenova/transformers to enable: npm i @xenova/transformers`);
    console.warn(`[sentiment-v2] Falling back to lexical sentiment analysis`);
    return false;
  }
}

async function computeEmbedding(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error("Extractor not initialized");
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return output.data as Float32Array;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Векторы уже нормализованы (normalize: true), так что dot = cosine
  return dot;
}

/**
 * Sentiment v2 через embeddings.
 * Возвращает null, если пакет не установлен — fallback на v1.
 */
export async function analyzeSentimentV2(text: string): Promise<SentimentResult | null> {
  const ok = await initialize();
  if (!ok || !extractor) return null;

  try {
    const messageEmbedding = await computeEmbedding(text);

    // Считаем максимальную similarity с негативными эталонами
    let maxNegSimilarity = 0;
    for (const ref of negativeEmbeddings) {
      const sim = cosineSimilarity(messageEmbedding, ref);
      if (sim > maxNegSimilarity) maxNegSimilarity = sim;
    }

    // Считаем максимальную similarity с позитивными эталонами
    let maxPosSimilarity = 0;
    for (const ref of positiveEmbeddings) {
      const sim = cosineSimilarity(messageEmbedding, ref);
      if (sim > maxPosSimilarity) maxPosSimilarity = sim;
    }

    // Нормализуем в score -1..1
    // Если neg > pos → отрицательный score, иначе положительный
    const diff = maxPosSimilarity - maxNegSimilarity;
    const score = Math.max(-1, Math.min(1, diff * 2)); // усиливаем контраст

    let label: "negative" | "neutral" | "positive";
    if (score < -0.15) label = "negative";
    else if (score > 0.15) label = "positive";
    else label = "neutral";

    // Triggers: какие эталонные фразы совпали больше всего
    const triggers: { word: string; weight: number }[] = [];
    if (maxNegSimilarity > 0.6) {
      triggers.push({ word: "негативная семантика", weight: maxNegSimilarity });
    }
    if (maxPosSimilarity > 0.6) {
      triggers.push({ word: "позитивная семантика", weight: maxPosSimilarity });
    }

    return {
      score,
      label,
      triggers,
      shouldEscalate: score < -0.3 || maxNegSimilarity > 0.75,
    };
  } catch (e) {
    console.warn("[sentiment-v2] Failed:", e);
    return null;
  }
}

/**
 * Гибридный sentiment: v2 (embeddings) → fallback v1 (лексический).
 *
 * Если embeddings доступны — используем их (точнее).
 * Иначе — откатываемся на лексический анализ.
 */
export async function analyzeSentimentHybrid(text: string): Promise<SentimentResult> {
  const v2Result = await analyzeSentimentV2(text);
  if (v2Result) {
    return {
      ...v2Result,
      triggers: [...v2Result.triggers, { word: "[v2:embeddings]", weight: 0 }],
    };
  }
  // Fallback на v1
  const v1Result = analyzeSentiment(text);
  return {
    ...v1Result,
    triggers: [...v1Result.triggers, { word: "[v1:lexical]", weight: 0 }],
  };
}

/**
 * Проверка: доступен ли sentiment v2.
 */
export function isSentimentV2Available(): boolean {
  return isInitialized && extractor !== null;
}

/**
 * Статус инициализации (для отладки).
 */
export function getSentimentV2Status(): {
  initialized: boolean;
  available: boolean;
  error: string | null;
  referencesCount: { negative: number; positive: number };
} {
  return {
    initialized: isInitialized,
    available: extractor !== null,
    error: initError,
    referencesCount: {
      negative: negativeEmbeddings.length,
      positive: positiveEmbeddings.length,
    },
  };
}
