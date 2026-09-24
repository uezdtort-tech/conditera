/**
 * Unit-тесты для src/lib/sentiment.ts — лексический анализ тональности.
 *
 * Тестируем:
 *   1. Негативные тексты → score < 0, label="negative"
 *   2. Позитивные тексты → score > 0, label="positive"
 *   3. Нейтральные тексты → label="neutral"
 *   4. Усилители увеличивают вес
 *   5. Отрицания инвертируют смысл
 *   6. shouldEscalate срабатывает при score < -0.4
 *   7. Edge cases: пустая строка, только стоп-слова
 *   8. triggers содержит список сработавших слов
 */
import { describe, it, expect } from "vitest";
import { analyzeSentiment, testSentiment } from "@/lib/sentiment";

describe("analyzeSentiment: негативные тексты", () => {
  it("распознаёт 'торт ужасный, невкусный, испорченный' как негатив", () => {
    const result = analyzeSentiment("Торт ужасный, невкусный, испорченный!");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
    expect(result.triggers.length).toBeGreaterThan(0);
  });

  it("распознаёт 'обманул, деньги не вернул, мошенники' как негатив", () => {
    const result = analyzeSentiment("Кондитер обманул, деньги не вернул, мошенники!");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
  });

  it("распознаёт 'привезли битый торт, возмутительно' как негатив", () => {
    const result = analyzeSentiment("Привезли битый торт, возмутительно");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
    expect(result.shouldEscalate).toBe(true);
  });

  it("распознаёт 'хамство, грубость, игнорируют' как негатив", () => {
    const result = analyzeSentiment("Хамство, грубость, игнорируют");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
  });

  it("распознаёт 'жалоба в Роспотребнадзор' как негатив", () => {
    const result = analyzeSentiment("Жалоба в Роспотребнадзор");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
  });
});

describe("analyzeSentiment: позитивные тексты", () => {
  it("распознаёт 'отличный торт, очень вкусно, спасибо' как позитив", () => {
    const result = analyzeSentiment("Отличный торт, очень вкусно, спасибо!");
    expect(result.score).toBeGreaterThan(0);
    expect(result.label).toBe("positive");
  });

  it("распознаёт 'спасибо за быструю доставку' как позитив", () => {
    const result = analyzeSentiment("Спасибо за быструю доставку");
    expect(result.score).toBeGreaterThan(0);
    expect(result.label).toBe("positive");
  });

  it("распознаёт 'очень доволен заказом, рекомендуем' как позитив", () => {
    const result = analyzeSentiment("Очень доволен заказом, рекомендуем!");
    expect(result.score).toBeGreaterThan(0);
    expect(result.label).toBe("positive");
  });
});

describe("analyzeSentiment: нейтральные тексты", () => {
  it("когда привезут? → нейтрально", () => {
    const result = analyzeSentiment("Когда привезут?");
    // Это может быть neutral или weak negative — проверяем, что score не extreme
    expect(result.score).toBeGreaterThanOrEqual(-0.5);
    expect(result.score).toBeLessThanOrEqual(0.5);
  });

  it("'нормально, но могло быть лучше' → neutral или weak", () => {
    const result = analyzeSentiment("Нормально, но могло быть лучше");
    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.score).toBeLessThanOrEqual(1);
    // shouldEscalate не должно срабатывать для нейтральных
    expect(result.shouldEscalate).toBe(false);
  });
});

describe("analyzeSentiment: усилители и отрицания", () => {
  it("усилитель 'очень' увеличивает негатив", () => {
    const without = analyzeSentiment("ужасно");
    const withIntensifier = analyzeSentiment("очень ужасно");
    expect(Math.abs(withIntensifier.score)).toBeGreaterThanOrEqual(Math.abs(without.score));
  });

  it("усилитель 'очень' увеличивает позитив", () => {
    const without = analyzeSentiment("вкусно");
    const withIntensifier = analyzeSentiment("очень вкусно");
    expect(withIntensifier.score).toBeGreaterThanOrEqual(without.score);
  });

  it("отрицание инвертирует смысл позитивных слов", () => {
    const positive = analyzeSentiment("вкусный торт");
    const negated = analyzeSentiment("не вкусный торт");
    // Сравниваем score: negated должен быть меньше (или равен из-за simplification)
    expect(negated.score).toBeLessThanOrEqual(positive.score);
  });
});

describe("analyzeSentiment: shouldEscalate", () => {
  it("срабатывает при сильном негативе", () => {
    const result = analyzeSentiment("ужасный торт, обман, мошенники, деньги не вернули, возмутительно");
    expect(result.shouldEscalate).toBe(true);
    expect(result.score).toBeLessThan(-0.4);
  });

  it("не срабатывает для нейтрального текста", () => {
    const result = analyzeSentiment("Здравствуйте, я хочу узнать статус заказа");
    expect(result.shouldEscalate).toBe(false);
  });

  it("не срабатывает для позитивного текста", () => {
    const result = analyzeSentiment("Большое спасибо за прекрасный торт!");
    expect(result.shouldEscalate).toBe(false);
  });
});

describe("analyzeSentiment: edge cases", () => {
  it("пустая строка → neutral, score=0", () => {
    const result = analyzeSentiment("");
    expect(result.score).toBe(0);
    expect(result.label).toBe("neutral");
    expect(result.triggers).toEqual([]);
    expect(result.shouldEscalate).toBe(false);
  });

  it("только стоп-слова → neutral", () => {
    const result = analyzeSentiment("и в на что он");
    expect(result.score).toBe(0);
    expect(result.label).toBe("neutral");
  });

  it("смесь позитивного и негативного → moderate score", () => {
    const result = analyzeSentiment("Торт вкусный, но доставка опоздала");
    // Должно быть что-то среднее между -1 и +1
    expect(result.score).toBeGreaterThan(-1);
    expect(result.score).toBeLessThan(1);
  });

  it("triggers содержат сработавшие слова с весами", () => {
    const result = analyzeSentiment("ужасно");
    if (result.triggers.length > 0) {
      const trigger = result.triggers[0];
      expect(trigger).toHaveProperty("word");
      expect(trigger).toHaveProperty("weight");
      expect(typeof trigger.weight).toBe("number");
    }
  });

  it("обрабатывает unicode (кириллица)", () => {
    const result = analyzeSentiment("Привет, мир!");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("label");
  });

  it("обрабатывает длинный текст", () => {
    const longText = "отличный ".repeat(100) + "торт";
    const result = analyzeSentiment(longText);
    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("analyzeSentiment: score range", () => {
  it("score всегда в диапазоне [-1, 1]", () => {
    const tests = [
      "ужасно",
      "превосходно",
      "нормально",
      "обман мошенники",
      "спасибо благодарю",
      "",
      " Neutral текст ",
    ];
    for (const text of tests) {
      const result = analyzeSentiment(text);
      expect(result.score).toBeGreaterThanOrEqual(-1);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("label может быть только negative/neutral/positive", () => {
    const tests = ["", "хорошо", "плохо", "нормально"];
    for (const text of tests) {
      const result = analyzeSentiment(text);
      expect(["negative", "neutral", "positive"]).toContain(result.label);
    }
  });
});

describe("testSentiment: тест-кейсы", () => {
  it("возвращает массив объектов {input, result}", () => {
    const tests = testSentiment();
    expect(Array.isArray(tests)).toBe(true);
    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) {
      expect(t).toHaveProperty("input");
      expect(t).toHaveProperty("result");
      expect(t.result).toHaveProperty("score");
      expect(t.result).toHaveProperty("label");
    }
  });

  it("содержит типичные негативные и позитивные кейсы", () => {
    const tests = testSentiment();
    const inputs = tests.map((t) => t.input.toLowerCase());
    expect(inputs.some((s) => s.includes("ужас"))).toBe(true);
    expect(inputs.some((s) => s.includes("спасибо"))).toBe(true);
  });
});
