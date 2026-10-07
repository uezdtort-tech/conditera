/**
 * Unit-тесты Capacity Engine — математика окон (ТЗ P0.5 §9, §45).
 * Пример ТЗ §9: окно 09:00–18:00, занято 10:00-12:00 и 12:00-15:00
 * → available = 4h (09:00-10:00 + 15:00-18:00), не 9h.
 */

import { describe, expect, it } from "vitest";
import {
  computeFreeWindows,
  findFreeWindow,
  mergeBusy,
  totalFreeMinutes,
  utilizationPercent,
} from "./capacity";
import {
  checklistTemplateForCategory,
  readyPhotoRequiredForCategory,
  checklistTemplateForCategory as tpl,
} from "./lifecycle-config";

describe("mergeBusy", () => {
  it("сливает пересекающиеся и смежные интервалы", () => {
    const merged = mergeBusy([
      { start: 600, end: 720 }, // 10:00-12:00
      { start: 720, end: 900 }, // 12:00-15:00 (смежный)
      { start: 540, end: 560 }, // раньше, врозь
    ]);
    expect(merged).toEqual([
      { start: 540, end: 560 },
      { start: 600, end: 900 },
    ]);
  });

  it("игнорирует пустые интервалы", () => {
    expect(mergeBusy([{ start: 100, end: 100 }])).toEqual([]);
  });
});

describe("computeFreeWindows — пример ТЗ §9", () => {
  it("09:00-18:00 с занятостью 10-12 и 12-15 → свободно 4 часа", () => {
    const windows = computeFreeWindows(
      [
        { start: 600, end: 720 },
        { start: 720, end: 900 },
      ],
      540,
      1080
    );
    expect(windows).toEqual([
      { start: 540, end: 600, minutes: 60 }, // 09:00-10:00
      { start: 900, end: 1080, minutes: 180 }, // 15:00-18:00
    ]);
    expect(totalFreeMinutes(windows)).toBe(240); // 4 часа, НЕ 9
  });

  it("пустой день → одно большое окно", () => {
    const windows = computeFreeWindows([], 540, 1080);
    expect(windows).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
  });

  it("полностью занятый день → нет окон", () => {
    const windows = computeFreeWindows([{ start: 540, end: 1080 }], 540, 1080);
    expect(windows).toEqual([]);
  });
});

describe("findFreeWindow", () => {
  const windows = [
    { start: 540, end: 600, minutes: 60 },
    { start: 900, end: 1080, minutes: 180 },
  ];

  it("влезает в первое подходящее окно", () => {
    expect(findFreeWindow(windows, 60)).toEqual({ start: 540, end: 600, minutes: 60 });
    expect(findFreeWindow(windows, 120)).toEqual({ start: 900, end: 1080, minutes: 180 });
  });

  it("не влезает никуда → null", () => {
    expect(findFreeWindow(windows, 200)).toBeNull();
  });

  it("earliestMinute отсекает ранние окна", () => {
    // 09:00-10:00 уже в прошлом (earliest 10:00) → берём 15:00-18:00
    expect(findFreeWindow(windows, 60, 610)).toEqual({ start: 900, end: 1080, minutes: 180 });
  });

  it("окно, начинающееся позже earliest, но влезающее — учитывается", () => {
    expect(findFreeWindow(windows, 170, 800)).toEqual({ start: 900, end: 1080, minutes: 180 });
    expect(findFreeWindow(windows, 180, 901)).toBeNull(); // 180 мин не влезают с 15:01
  });
});

describe("utilizationPercent", () => {
  it("0% / частичная / перегруз", () => {
    expect(utilizationPercent(0, 540, 1080)).toBe(0);
    expect(utilizationPercent(270, 540, 1080)).toBe(50);
    // 900 занятых минут на 540-минутный день → 167%
    expect(utilizationPercent(900, 540, 1080)).toBe(167);
    // экстремальный перегруз ограничивается 999%
    expect(utilizationPercent(540000, 540, 1080)).toBe(999);
  });
});

describe("checklist templates (ТЗ §18)", () => {
  it("торт — полный конвейер с фото", () => {
    const stages = tpl("cakes").map((s) => s.key);
    expect(stages).toContain("baking");
    expect(stages).toContain("quality_check");
    expect(stages).toContain("ready_photo");
    expect(stages[0]).toBe("ingredients_prepared");
  });

  it("печенье — без сборки/крема", () => {
    const stages = checklistTemplateForCategory("cookies").map((s) => s.key);
    expect(stages).not.toContain("assembly");
    expect(stages).toContain("baking");
  });

  it("реалистичный торт до cakes (порядок шаблонов)", () => {
    expect(readyPhotoRequiredForCategory("realistic_cakes")).toBe(true);
    expect(readyPhotoRequiredForCategory("cupcakes")).toBe(false);
    expect(readyPhotoRequiredForCategory("cookies")).toBe(false);
  });

  it("неизвестная категория → дефолтный шаблон", () => {
    expect(checklistTemplateForCategory("unknown_cat")).toEqual(checklistTemplateForCategory(null));
  });
});
