/**
 * Sentiment analysis: лёгкий детект негатива в сообщениях без ML.
 *
 * Подход: лексический анализ с加权 scoring.
 * - negativeWords: список негативных слов с весами
 * - intensifiers: слова-усилители ("очень", "совсем", "никак")
 * - negations: отрицания ("не", "нет")
 *
 * Возвращает:
 *  - score: -1..1 (отрицательный = негатив, 0 = нейтрально, +1 = позитив)
 *  - label: "negative" | "neutral" | "positive"
 *  - triggers: список сработавших негативных слов
 *
 * Если score < -0.4 → авто-эскалация на оператора.
 *
 * Будущее: заменить на embeddings через @xenova/transformers для семантики.
 */

// ===== Негативные слова с весами =====
const NEGATIVE_WORDS: Record<string, number> = {
  // Жалобы на качество
  "невкусн": 0.7,
  "плохой": 0.6,
  "плохо": 0.5,
  "ужас": 0.8,
  "ужасно": 0.8,
  "отстой": 0.8,
  "мерзк": 0.8,
  "отвратительн": 0.9,
  "испорчен": 0.8,
  "испортил": 0.8,
  "битый": 0.7,
  "треснул": 0.6,
  "размазан": 0.7,
  "потек": 0.6,
  "не тот": 0.7,
  "не то": 0.5,
  "ошибк": 0.6,
  "опоздал": 0.6,
  "опаздыва": 0.6,
  "холодный": 0.4,
  "остыл": 0.4,

  // Жалобы на сервис
  "обман": 0.9,
  "обманул": 0.9,
  "врал": 0.8,
  "врун": 0.8,
  "наглость": 0.8,
  "хам": 0.7,
  "хамство": 0.8,
  "груб": 0.7,
  "грубо": 0.6,
  "некультурн": 0.7,
  "проигнорир": 0.6,
  "игнорир": 0.5,
  "не отвечает": 0.6,
  "не ответил": 0.6,
  "не отвечают": 0.6,

  // Финансовые претензии
  "возврат": 0.5,        // нейтрально в контексте, но часто в негативе
  "верните деньги": 0.8,
  "деньги не вернул": 0.9,
  "мошеннич": 0.9,
  "мошенник": 0.9,
  "кинул на деньги": 0.9,
  "переплат": 0.5,
  "дороже": 0.3,
  "скрытые платежи": 0.8,

  // Эмоциональные
  "ненавиж": 0.9,
  "возмутительн": 0.8,
  "бесит": 0.7,
  "раздража": 0.6,
  "разочарован": 0.7,
  "разочаров": 0.6,
  "никогда не": 0.6,
  "больше не": 0.5,

  // Юридические
  "жалоб": 0.7,
  "прокуратур": 0.9,
  "суд": 0.6,
  "заявление": 0.5,
  "полиц": 0.7,
  "защита прав": 0.6,
  "ропотребнадзор": 0.9,

  // Грубые
  "фу": 0.7,
  "жесть": 0.6,
  "бред": 0.6,
  "чушь": 0.6,
};

// ===== Позитивные слова (для балансировки) =====
const POSITIVE_WORDS: Record<string, number> = {
  "спасибо": 0.5,
  "благодар": 0.6,
  "отличн": 0.7,
  "превосходн": 0.8,
  "замечательн": 0.7,
  "вкусн": 0.6,
  "нравится": 0.5,
  "понравил": 0.6,
  "класс": 0.5,
  "супер": 0.6,
  "шикарн": 0.7,
  "красив": 0.4,
  "быстро": 0.3,
  "вовремя": 0.4,
  "аккуратн": 0.4,
  "свеж": 0.4,
  "доволен": 0.6,
  "довольна": 0.6,
  "рекоменд": 0.5,
};

// ===== Усилители =====
const INTENSIFIERS = ["очень", "совсем", "полностью", "абсолютно", "крайне", "весьма"];
const INTENSIFIER_FACTOR = 1.5;

// ===== Отрицания (инвертируют следующее слово) =====
const NEGATIONS = ["не", "нет", "ни", "никак", "никогда"];

// ===== Сторонние стоп-слова =====
const STOPWORDS = new Set([
  "и", "в", "во", "что", "он", "на", "я", "с", "со", "как", "а", "то",
  "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы",
]);

export interface SentimentResult {
  score: number;          // -1..1
  label: "negative" | "neutral" | "positive";
  triggers: { word: string; weight: number }[];
  shouldEscalate: boolean;
}

/**
 * Анализ тональности текста.
 * Возвращает score, label, triggers.
 *
 * Threshold для авто-эскалации: score < -0.4
 */
export function analyzeSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  const tokens = lower
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  let negativeScore = 0;
  let positiveScore = 0;
  const triggers: { word: string; weight: number }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (STOPWORDS.has(token)) continue;

    // Проверяем отрицание перед словом
    const prevToken = tokens[i - 1] || "";
    const isNegated = NEGATIONS.includes(prevToken);

    // Проверяем усилитель
    const prevPrevToken = tokens[i - 2] || "";
    const hasIntensifier =
      INTENSIFIERS.includes(prevToken) || INTENSIFIERS.includes(prevPrevToken);
    const factor = hasIntensifier ? INTENSIFIER_FACTOR : 1;

    // Проверяем негативные слова (по префиксу токена, не подстроке всего текста)
    for (const [negWord, weight] of Object.entries(NEGATIVE_WORDS)) {
      if (token.startsWith(negWord)) {
        const effectiveWeight = (isNegated ? -weight : weight) * factor;
        if (effectiveWeight > 0) {
          negativeScore += effectiveWeight;
          triggers.push({ word: negWord, weight: effectiveWeight });
        } else {
          positiveScore += Math.abs(effectiveWeight);
        }
        break;
      }
    }

    // Проверяем позитивные слова
    for (const [posWord, weight] of Object.entries(POSITIVE_WORDS)) {
      if (token.startsWith(posWord)) {
        const effectiveWeight = (isNegated ? -weight : weight) * factor;
        if (effectiveWeight > 0) {
          positiveScore += effectiveWeight;
        } else {
          negativeScore += Math.abs(effectiveWeight);
          triggers.push({ word: posWord, weight: effectiveWeight });
        }
        break;
      }
    }
  }

  // Нормализуем score: каждое слово добавляет 0..1, делим на количество триггеров
  const totalWords = tokens.length || 1;
  const rawScore = (positiveScore - negativeScore) / Math.sqrt(totalWords);
  const score = Math.max(-1, Math.min(1, rawScore));

  let label: "negative" | "neutral" | "positive";
  if (score < -0.2) label = "negative";
  else if (score > 0.2) label = "positive";
  else label = "neutral";

  return {
    score,
    label,
    triggers,
    shouldEscalate: score < -0.4,
  };
}

/**
 * Тест-кейсы для sentiment analysis (для отладки).
 */
export function testSentiment(): { input: string; result: SentimentResult }[] {
  const tests = [
    "Торт ужасный, невкусный, испорченный!",
    "Отличный торт, очень вкусно, спасибо!",
    "Нормально, но могло быть лучше",
    "Кондитер обманул, деньги не вернул, мошенники!",
    "Очень доволен заказом, рекомендуем!",
    "Привезли битый торт, возмутительно",
    "Когда привезут?",
    "Спасибо за быструю доставку",
    "Хамство, грубость, игнорируют",
    "Жалоба в Роспотребнадзор",
  ];
  return tests.map((input) => ({
    input,
    result: analyzeSentiment(input),
  }));
}
