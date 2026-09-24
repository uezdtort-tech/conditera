/**
 * ML-матчинг FAQ: гибридный подход без внешних зависимостей.
 *
 * Уровни матчинга (по убыванию точности):
 *  1. Exact keyword match — как в chat-faq.ts
 *  2. Token overlap (Jaccard) — общие токены между запросом и топиком
 *  3. Fuzzy match (Levenshtein) — для опечаток ("доставк" vs "доставка")
 *  4. Stemming (упрощённый) — "оплатить/оплатил/оплатите" → "оплат"
 *
 * Если итоговый score < threshold — возвращаем null (нужно эскалировать).
 *
 * В будущей версии: заменить на embeddings через @xenova/transformers
 * (local inference, без API-затрат).
 */

import { FAQ_TOPICS, FaqTopic } from "./chat-faq";

// ===== Токенизация =====
const STOPWORDS_RU = new Set([
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то",
  "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за",
  "бы", "по", "только", "ее", "мне", "было", "вот", "от", "меня", "о", "из",
  "ему", "теперь", "когда", "даже", "ну", "вдруг", "ли", "если", "уже", "или",
  "ни", "быть", "был", "него", "до", "вас", "нибудь", "опять", "уж", "вам",
  "ведь", "там", "потом", "себя", "ничего", "ей", "может", "они", "тут", "где",
  "есть", "надо", "ней", "для", "мы", "тебя", "их", "чем", "была", "сам", "чтоб",
  "без", "будто", "чего", "раз", "тоже", "себе", "под", "будет", "ж", "тогда",
  "кто", "этот", "того", "потому", "этого", "какой", "совсем", "ним", "здесь",
  "этом", "один", "почти", "мой", "тем", "чтобы", "нее", "сейчас", "были",
  "куда", "зачем", "всех", "никогда", "можно", "при", "наконец", "два", "об",
  "другой", "хоть", "после", "над", "больше", "тот", "через", "эти", "нас",
  "про", "всего", "них", "какая", "много", "разве", "три", "эту", "моя", "впрочем",
]);

/** Простая русская стеммизация (окончания) */
function stem(word: string): string {
  let w = word.toLowerCase();
  // Удаляем окончания
  const endings = ["ами", "ями", "иях", "ах", "ях", "ой", "ая", "яя", "ые", "ое",
                    "ие", "ый", "ий", "ого", "его", "ому", "ему", "ыми", "ими",
                    "ых", "их", "ую", "юю", "ей", "ть", "тся", "ться", "ешь",
                    "ишь", "ете", "ите", "ет", "ит", "ут", "ют", "ат", "ят", "ал",
                    "ял", "ала", "яла", "али", "яли", "ай", "айся", "ился", "аться"];
  for (const e of endings) {
    if (w.length > e.length + 2 && w.endsWith(e)) {
      w = w.slice(0, w.length - e.length);
      break;
    }
  }
  return w;
}

/** Токенизация: lowercase → split → remove stopwords → stem */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS_RU.has(t))
    .map(stem);
}

// ===== Jaccard similarity =====
function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// ===== Levenshtein distance (для опечаток) =====
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ===== Подготовка FAQ_TOPICS с пред-токенизированными keyword-сетами =====
interface PreparedTopic extends FaqTopic {
  keywordStems: Set<string>;          // stems из keywords
  answerStems: Set<string>;           // stems из answer
}

const PREPARED_TOPICS: PreparedTopic[] = FAQ_TOPICS.map((t) => ({
  ...t,
  keywordStems: new Set(t.keywords.flatMap(tokenize)),
  answerStems: new Set(tokenize(t.answer)),
}));

// ===== ML-matcher =====

export interface MlMatchResult {
  topic: FaqTopic;
  score: number;        // 0..1
  method: "keyword" | "jaccard" | "fuzzy" | "stem";
}

/**
 * Гибридный matcher.
 * Возвращает лучший топик с score, либо null если score < threshold.
 */
export function matchFaqMl(message: string, threshold: number = 0.2): MlMatchResult | null {
  const messageTokens = tokenize(message);
  const messageStems = new Set(messageTokens);

  let best: MlMatchResult | null = null;

  for (const topic of PREPARED_TOPICS) {
    // 1. Exact keyword match (высший приоритет)
    const lowerMessage = message.toLowerCase();
    let keywordScore = 0;
    for (const kw of topic.keywords) {
      if (lowerMessage.includes(kw)) {
        keywordScore += kw.length > 5 ? 2 : 1;
      }
    }
    if (keywordScore > 0) {
      const normalizedScore = Math.min(1, keywordScore / 3);
      if (!best || normalizedScore > best.score) {
        best = { topic, score: normalizedScore, method: "keyword" };
      }
      continue;
    }

    // 2. Stem overlap (Jaccard по stems)
    const keywordJaccard = jaccard(messageStems, topic.keywordStems);
    const answerJaccard = jaccard(messageStems, topic.answerStems);
    const jaccardScore = Math.max(keywordJaccard * 2, answerJaccard); // keywords весомее
    if (jaccardScore > 0.1) {
      if (!best || jaccardScore > best.score) {
        best = { topic, score: jaccardScore, method: "jaccard" };
      }
      continue;
    }

    // 3. Fuzzy match (для опечаток)
    let fuzzyScore = 0;
    for (const token of messageTokens) {
      if (token.length < 4) continue;
      for (const kw of topic.keywords) {
        const sim = similarity(token, kw);
        if (sim > fuzzyScore) fuzzyScore = sim;
      }
    }
    if (fuzzyScore > 0.7) {
      if (!best || fuzzyScore > best.score) {
        best = { topic, score: fuzzyScore, method: "fuzzy" };
      }
    }
  }

  return best && best.score >= threshold ? best : null;
}

/**
 * Прогон тестов для matcher-а (для отладки).
 */
export function testMatcher(): { input: string; matched: string | null; score: number; method: string }[] {
  const tests = [
    "Когда привезут мой торт?",
    "как оплатить заказ картой",
    "хочу отменить заказ",
    "у меня аллергия на орехи",
    "что такое эскроу",
    "сколько бонусов у меня",
    "доставк",  // опечатка
    "оплатить рассрочкой",
    "хочу пожаловаться на качество",
    "собрать свой торт",
    "случайный текст без совпадений",
  ];
  return tests.map((input) => {
    const result = matchFaqMl(input);
    return {
      input,
      matched: result?.topic.id || null,
      score: result?.score || 0,
      method: result?.method || "none",
    };
  });
}
