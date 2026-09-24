/**
 * A/B тест sentiment v1 (лексический) vs v2 (embeddings).
 *
 * Запускает оба анализатора на одном наборе тестовых сообщений,
 * сравнивает результаты, считает точность/recall.
 *
 * Запуск: npx tsx scripts/sentiment-ab-test.ts
 */

import { analyzeSentiment } from "../src/lib/sentiment";
import { analyzeSentimentV2 } from "../src/lib/sentiment-v2";

interface TestCase {
  text: string;
  expected: "negative" | "neutral" | "positive";
  shouldEscalate: boolean;
  category: string; // complaint | praise | neutral | question | mixed
}

const TEST_CASES: TestCase[] = [
  // === Жалобы (должны эскалироваться) ===
  { text: "Торт ужасный, невкусный, испорченный!", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Кондитер обманул, деньги не вернул, мошенники!", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Привезли битый торт, возмутительно", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Хамство, грубость, игнорируют поддержку", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Жалоба в роспотребнадзор, прокуратура", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Никогда не закажу снова, разочарован", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Отвратительный сервис, никогда больше", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Опоздали на 3 часа, торт растаял", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Не тот торт привезли, ошибка", expected: "negative", shouldEscalate: true, category: "complaint" },
  { text: "Возврат денег пожалуйста, торт испорчен", expected: "negative", shouldEscalate: true, category: "complaint" },

  // === Позитив (не должны эскалироваться) ===
  { text: "Отличный торт, очень вкусно, спасибо!", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Замечательная работа, красиво и аккуратно", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Быстрая доставка, свежий торт, рекомендую", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Очень доволен заказом, превзошло ожидания", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Спасибо за прекрасный торт на день рождения", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Вкусно, красиво, вовремя, рекомендую всем", expected: "positive", shouldEscalate: false, category: "praise" },
  { text: "Класс! Супер! Шикарно!", expected: "positive", shouldEscalate: false, category: "praise" },

  // === Нейтральные вопросы (не должны эскалироваться) ===
  { text: "Когда привезут мой заказ?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Как оплатить картой?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Что такое эскроу?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Сколько у меня бонусов?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Как отменить заказ?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Можно ли изменить состав заказа?", expected: "neutral", shouldEscalate: false, category: "question" },
  { text: "Где отследить заказ?", expected: "neutral", shouldEscalate: false, category: "question" },

  // === Сложные/смешанные ===
  { text: "Торт вкусный, но привезли поздно", expected: "neutral", shouldEscalate: false, category: "mixed" },
  { text: "Красивый, но невкусный", expected: "negative", shouldEscalate: false, category: "mixed" },
  { text: "Не понравилась начинка, но сервис хороший", expected: "neutral", shouldEscalate: false, category: "mixed" },
  { text: "Дорого, но качество отличное", expected: "neutral", shouldEscalate: false, category: "mixed" },
];

interface TestResult {
  text: string;
  expected: string;
  expectedEscalate: boolean;
  v1: { label: string; score: number; escalate: boolean };
  v2: { label: string; score: number; escalate: boolean } | null;
  v1Correct: boolean;
  v2Correct: boolean;
  v1EscalateCorrect: boolean;
  v2EscalateCorrect: boolean;
}

async function main() {
  console.info("=".repeat(80));
  console.info("  A/B ТЕСТ SENTIMENT V1 (лексический) vs V2 (embeddings)");
  console.info("=".repeat(80));
  console.info(`\nТестовых сообщений: ${TEST_CASES.length}`);
  console.info("  • Жалобы (должны эскалироваться): 10");
  console.info("  • Позитив: 7");
  console.info("  • Нейтральные вопросы: 7");
  console.info("  • Смешанные: 4\n");

  const results: TestResult[] = [];

  console.info("Запуск v2 (первая инициализация ~5 сек)...\n");

  for (const tc of TEST_CASES) {
    // V1 — синхронный
    const v1Result = analyzeSentiment(tc.text);

    // V2 — асинхронный
    const v2Result = await analyzeSentimentV2(tc.text);

    const v1Correct = v1Result.label === tc.expected;
    const v2Correct = v2Result ? v2Result.label === tc.expected : false;
    const v1EscalateCorrect = v1Result.shouldEscalate === tc.shouldEscalate;
    const v2EscalateCorrect = v2Result ? v2Result.shouldEscalate === tc.shouldEscalate : false;

    results.push({
      text: tc.text,
      expected: tc.expected,
      expectedEscalate: tc.shouldEscalate,
      v1: {
        label: v1Result.label,
        score: v1Result.score,
        escalate: v1Result.shouldEscalate,
      },
      v2: v2Result ? {
        label: v2Result.label,
        score: v2Result.score,
        escalate: v2Result.shouldEscalate,
      } : null,
      v1Correct,
      v2Correct,
      v1EscalateCorrect,
      v2EscalateCorrect,
    });
  }

  // ===== Вывод таблицы =====
  console.info("\n" + "=".repeat(80));
  console.info("  ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ");
  console.info("=".repeat(80) + "\n");

  console.info(
    "Сообщение".padEnd(45) +
    "Ожидание".padEnd(12) +
    "V1".padEnd(20) +
    "V2".padEnd(20)
  );
  console.info("-".repeat(97));

  for (const r of results) {
    const text = r.text.length > 43 ? r.text.slice(0, 40) + "..." : r.text;
    const v1Str = `${r.v1.label} (${r.v1.score.toFixed(2)})${r.v1.escalate ? "⚡" : ""}`;
    const v2Str = r.v2 ? `${r.v2.label} (${r.v2.score.toFixed(2)})${r.v2.escalate ? "⚡" : ""}` : "N/A";

    console.info(
      text.padEnd(45) +
      r.expected.padEnd(12) +
      (r.v1Correct ? "✓ " : "✗ ") + v1Str.padEnd(18) +
      (r.v2Correct ? "✓ " : "✗ ") + v2Str.padEnd(18)
    );
  }

  // ===== Статистика =====
  console.info("\n" + "=".repeat(80));
  console.info("  СТАТИСТИКА");
  console.info("=".repeat(80) + "\n");

  const v1LabelCorrect = results.filter((r) => r.v1Correct).length;
  const v2LabelCorrect = results.filter((r) => r.v2Correct).length;
  const v1EscalateCorrect = results.filter((r) => r.v1EscalateCorrect).length;
  const v2EscalateCorrect = results.filter((r) => r.v2EscalateCorrect).length;

  console.info(`Label точность (negative/neutral/positive):`);
  console.info(`  V1 (лексический): ${v1LabelCorrect}/${results.length} = ${(v1LabelCorrect / results.length * 100).toFixed(1)}%`);
  console.info(`  V2 (embeddings):  ${v2LabelCorrect}/${results.length} = ${(v2LabelCorrect / results.length * 100).toFixed(1)}%`);

  console.info(`\nЭскалация точность (должен/не должен):`);
  console.info(`  V1: ${v1EscalateCorrect}/${results.length} = ${(v1EscalateCorrect / results.length * 100).toFixed(1)}%`);
  console.info(`  V2: ${v2EscalateCorrect}/${results.length} = ${(v2EscalateCorrect / results.length * 100).toFixed(1)}%`);

  // По категориям
  console.info("\nТочность по категориям:");
  const categories = ["complaint", "praise", "question", "mixed"];
  for (const cat of categories) {
    const catResults = results.filter((_, i) => TEST_CASES[i].category === cat);
    const v1Cat = catResults.filter((r) => r.v1Correct).length;
    const v2Cat = catResults.filter((r) => r.v2Correct).length;
    const labels: Record<string, string> = {
      complaint: "Жалобы",
      praise: "Позитив",
      question: "Вопросы",
      mixed: "Смешанные",
    };
    console.info(`  ${labels[cat].padEnd(12)} V1: ${v1Cat}/${catResults.length}  |  V2: ${v2Cat}/${catResults.length}`);
  }

  // Где v2 лучше v1
  console.info("\nГде V2 лучше V1:");
  const v2Better = results.filter((r) => !r.v1Correct && r.v2Correct);
  if (v2Better.length === 0) {
    console.info("  (нет случаев, где V2 лучше)");
  }
  for (const r of v2Better) {
    console.info(`  ✓ "${r.text.slice(0, 50)}" — V1: ${r.v1.label}, V2: ${r.v2?.label} (ожидали ${r.expected})`);
  }

  console.info("\nГде V1 лучше V2:");
  const v1Better = results.filter((r) => !r.v2Correct && r.v1Correct);
  if (v1Better.length === 0) {
    console.info("  (нет случаев, где V1 лучше)");
  }
  for (const r of v1Better) {
    console.info(`  ✓ "${r.text.slice(0, 50)}" — V1: ${r.v1.label}, V2: ${r.v2?.label} (ожидали ${r.expected})`);
  }

  // Итог
  console.info("\n" + "=".repeat(80));
  if (v2LabelCorrect > v1LabelCorrect) {
    console.info(`  ✅ V2 (embeddings) ТОЧНЕЕ V1 (лексический) на ${v2LabelCorrect - v1LabelCorrect} сообщений`);
  } else if (v1LabelCorrect > v2LabelCorrect) {
    console.info(`  ⚠ V1 (лексический) точнее V2 на ${v1LabelCorrect - v2LabelCorrect} сообщений`);
  } else {
    console.info(`  ≈ Одинаковая точность: ${v1LabelCorrect}/${results.length}`);
  }
  console.info("=".repeat(80));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
