import { describe, expect, it } from "vitest";
import {
  configToVisual,
  resolveVisualShape,
  inscriptionColorOn,
  DECOR_GLYPH_FALLBACK,
} from "./cake-visual-map";
import type { CakeBuilderConfig } from "./cake-builder-pricing";

describe("configToVisual → shape", () => {
  it("пустой конфиг: other, нейтральные дефолты, без декора и надписи", () => {
    const v = configToVisual({});
    expect(v.shape).toBe("other");
    expect(v.baseColor).toMatch(/^#/);
    expect(v.coatingColor).toMatch(/^#/);
    expect(v.fillingAccent).toMatch(/^#/);
    expect(v.decorIcons).toEqual([]);
    expect(v.inscription).toBe("");
    expect(v.drip).toBe(false);
    expect(v.tiers).toBe(1);
  });

  it("null-конфиг не падает (деградация к дефолтам)", () => {
    expect(() => configToVisual(null as unknown as CakeBuilderConfig)).not.toThrow();
    expect(configToVisual(null as unknown as CakeBuilderConfig).shape).toBe("other");
  });

  it("торт (cake) → round", () => {
    expect(configToVisual({ productType: "cake" }).shape).toBe("round");
  });

  it("муссовый торт и тарт тоже round; бенто → square", () => {
    expect(configToVisual({ productType: "mousse_cake" }).shape).toBe("round");
    expect(configToVisual({ productType: "tart" }).shape).toBe("round");
    expect(configToVisual({ productType: "bento" }).shape).toBe("square");
  });

  it("капкейки → cupcakes (ряд), 1 ярус даже при servings=30", () => {
    const v = configToVisual({ productType: "cupcakes", servings: 30 });
    expect(v.shape).toBe("cupcakes");
    expect(v.tiers).toBe(1);
  });

  it("явная форма из шага 2.5 старше productType: heart на бенто, square на торте", () => {
    expect(configToVisual({ productType: "bento", shape: "heart" }).shape).toBe("heart");
    expect(configToVisual({ productType: "cake", shape: "square" }).shape).toBe("square");
  });

  it("неизвестный productType → other", () => {
    expect(configToVisual({ productType: "alien_dessert" }).shape).toBe("other");
  });
});

describe("configToVisual → палитра и ярусы", () => {
  it("покрытия маппятся в реалистичную палитру: белый ганаш #f5efe6, тёмный #4a3626", () => {
    expect(configToVisual({ coating: "ganache_white" }).coatingColor).toBe("#f5efe6");
    expect(configToVisual({ coating: "ganache_dark" }).coatingColor).toBe("#4a3626");
    expect(configToVisual({ coating: "mirror_glaze" }).coatingColor).toBe("#8b2635");
  });

  it("неизвестное покрытие/основа/начинка → дефолты, не undefined", () => {
    const v = configToVisual({ coating: "unknown", base: "unknown", filling: "unknown" });
    expect(v.coatingColor).toMatch(/^#/);
    expect(v.baseColor).toMatch(/^#/);
    expect(v.fillingAccent).toMatch(/^#/);
  });

  it("зеркальная глазурь даёт подтёки (drip), другие покрытия — нет", () => {
    expect(configToVisual({ coating: "mirror_glaze" }).drip).toBe(true);
    expect(configToVisual({ coating: "mastic" }).drip).toBe(false);
    expect(configToVisual({}).drip).toBe(false);
  });

  it("2 яруса: tiers>=2 или порций>=15; иначе 1", () => {
    expect(configToVisual({ productType: "cake", tiers: 2 }).tiers).toBe(2);
    expect(configToVisual({ productType: "cake", servings: 20 }).tiers).toBe(2);
    expect(configToVisual({ productType: "cake", tiers: 1, servings: 8 }).tiers).toBe(1);
    expect(configToVisual({ productType: "cake", tiers: 4 }).tiers).toBe(2); // clamp 1..2
  });
});

describe("configToVisual → декор и надпись", () => {
  it("известные декоры → свои глифы", () => {
    const v = configToVisual({ decorations: ["berries", "sugar_flowers"] });
    expect(v.decorIcons).toEqual(["🍓", "🌸"]);
  });

  it("неизвестный декор → fallback 🎀", () => {
    const v = configToVisual({ decorations: ["mystery_decor"] });
    expect(v.decorIcons).toEqual([DECOR_GLYPH_FALLBACK]);
  });

  it("дубли декора не удваиваются; битые элементы отбрасываются; лимит 5", () => {
    const v = configToVisual({
      decorations: [
        "berries",
        "berries",
        42 as unknown as string,
        "",
        "edible_gold",
        "macarons",
        "meringue",
        "fresh_fruit",
        "chocolate_curls",
        "wafer_paper",
      ],
    });
    expect(v.decorIcons).toHaveLength(5);
    expect(v.decorIcons.filter((g) => g === "🍓")).toHaveLength(1);
  });

  it("надпись: trimmed и переносится в превью", () => {
    expect(configToVisual({ inscription: "  С Днём Рождения!  " }).inscription).toBe("С Днём Рождения!");
  });

  it("длинная надпись обрезается до 40 символов с многоточием", () => {
    const long = "С".repeat(60);
    const v = configToVisual({ inscription: long });
    expect(v.inscription).toHaveLength(40);
    expect(v.inscription.endsWith("…")).toBe(true);
  });

  it("decorations не-массив (битый конфиг) → пустой список, не падение", () => {
    const v = configToVisual({ decorations: "berries" as unknown as string[] });
    expect(v.decorIcons).toEqual([]);
  });
});

describe("resolveVisualShape / inscriptionColorOn", () => {
  it("resolveVisualShape: полный приоритет shape > productType > other", () => {
    expect(resolveVisualShape({ productType: "cake" })).toBe("round");
    expect(resolveVisualShape({ productType: "cupcakes", shape: "round" })).toBe("cupcakes");
    expect(resolveVisualShape({})).toBe("other");
  });

  it("inscriptionColorOn: тёмный ганаш → кремовый текст, светлый крем-чиз → бордо", () => {
    expect(inscriptionColorOn("#4a3626")).toBe("#f7f1e3");
    expect(inscriptionColorOn("#8b2635")).toBe("#f7f1e3");
    expect(inscriptionColorOn("#f5efe6")).toBe("#8b2635");
    expect(inscriptionColorOn("не цвет")).toBe("#8b2635");
  });
});
