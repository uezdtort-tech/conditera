/**
 * cake-visual-map.ts — чистый маппер CakeBuilderConfig → параметры SVG-превью.
 *
 * ADAPT инновации Qwen (VisualConstructor, qwentopt bfb2c04): их компонент
 * хранил цвета в собственном mock-сторе и считал цену на клиенте. Здесь
 * ТОЛЬКО визуальное отображение реальной конфигурации конструктора:
 *   • вход — настоящий CakeBuilderConfig (src/lib/cake-builder-pricing.ts);
 *   • цены НЕ вычисляются (серверный пересчёт обязателен);
 *   • маппинг изоморфный и чистый — юнит-тестируется без DOM.
 *
 * Палитра реалистична (ганаш, мастика, ягодные начинки) и согласована с
 * фирменной тёплой гаммой «Уездного кондитера» (бордо ≈ #8b2635, крем фон).
 */

import type { CakeBuilderConfig } from "./cake-builder-pricing";

/** Обобщённая форма превью: round/square/heart — торт, cupcakes — ряд капкейков, other — стилизация. */
export type CakeVisualShape = "round" | "square" | "heart" | "cupcakes" | "other";

export interface CakeVisual {
  shape: CakeVisualShape;
  /** Цвет тела (бисквит/основа) — боковины и внутренний срез */
  baseColor: string;
  /** Акцентный слой начинки — полоса на срезе/между ярусами */
  fillingAccent: string;
  /** Цвет покрытия — верх/глазурь */
  coatingColor: string;
  /** Тянуться ли подтёки глазури (зеркальная глазурь → да) */
  drip: boolean;
  /** Эмодзи-глифы декора (известные декоры из CAKE_BUILDER_OPTIONS + fallback 🎀) */
  decorIcons: string[];
  /** Надпись: trimmed, ≤ 40 символов (с «…» при обрезке) */
  inscription: string;
  /** Число ярусов в превью: 1 или 2 (2 — если tiers ≥ 2 или порций ≥ 15) */
  tiers: 1 | 2;
}

// ===== Палитры (id из CAKE_BUILDER_OPTIONS в src/lib/mock-data.ts) =====

/** Покрытие → цвет глазури/верхнего слоя. */
export const COATING_COLORS: Record<string, string> = {
  cream_cheese: "#f7f1e3", // крем-чиз — тёплый молочный
  ganache_white: "#f5efe6", // белый ганаш
  ganache_dark: "#4a3626", // тёмный ганаш
  mirror_glaze: "#8b2635", // зеркальная глазурь — фирменное бордо
  velvet_spray: "#d9c2ae", // велюровое напыление
  mastic: "#fbf7ee", // сахарная мастика
};

/** Основа (бисквит) → цвет тела. */
export const BASE_COLORS: Record<string, string> = {
  sponge: "#f0d9a8", // классический бисквит
  mousse: "#f3e2d9", // мусс
  cheesecake: "#f8f0dd", // чизкейк
  honey: "#d8a95e", // медовик
  red_velvet: "#8f3a3a", // красный бархат
  biscuit: "#e8c98f", // песочный бисквит
};

/** Начинка → акцентный цвет слоя. */
export const FILLING_COLORS: Record<string, string> = {
  condensed_milk: "#c98a4b", // варёная сгущёнка
  cream_pleshir: "#fdf3d7", // крем пломбир
  chocolate_ganache: "#5a3b22", // шоколадный ганаш
  curd_cream: "#f6efe0", // творожный крем
  raspberry: "#b02a4c", // малиновый конфитюр
  mango_passion: "#e8933f", // манго-маракуйя
  strawberry: "#c94057", // клубничный конфитюр
  lemon_curd: "#e5b93c", // лимонный курд
};

/** Декор → эмодзи-глиф (id из CAKE_BUILDER_OPTIONS.decorations). */
export const DECOR_GLYPHS: Record<string, string> = {
  berries: "🍓",
  chocolate_curls: "🍫",
  macarons: "🍬",
  meringue: "☁️",
  sugar_flowers: "🌸",
  fresh_fruit: "🍑",
  edible_gold: "✨",
  wafer_paper: "🧇",
};

/** Fallback для неизвестного декора (DB-декоры, битые id). */
export const DECOR_GLYPH_FALLBACK = "🎀";

/** Порог «крупного» торта: порций ≥ 15 → рисуем 2 яруса. */
const TWO_TIER_SERVINGS_THRESHOLD = 15;

const INSCRIPTION_MAX_LEN = 40;

function pickColor(map: Record<string, string>, id: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return map[id] ?? fallback;
}

/** Цвета по умолчанию для пустого конфига — нейтральная «ваниль» на крем-чизе. */
const DEFAULT_BASE_COLOR = "#f0d9a8";
const DEFAULT_COATING_COLOR = "#f7f1e3";
const DEFAULT_FILLING_COLOR = "#d9a7a0"; // приглушённый ягодно-кремовый

/**
 * productType → обобщённая форма (контракт маппинга):
 *   торт (cake, mousse_cake) → round;
 *   бенто-торт (bento) → square;
 *   капкейки (cupcakes) → cupcakes (ряд из 3 штук);
 *   всё остальное / неизвестное → other (стилизованный десерт на подставке).
 * Явный выбор формы из шага 2.5 (config.shape) старше productType, но только
 * для геометрий, которые рисуем честно: round/square/heart.
 */
export function resolveVisualShape(config: CakeBuilderConfig): CakeVisualShape {
  if (config.productType === "cupcakes") return "cupcakes";
  if (config.shape === "square" || config.shape === "heart" || config.shape === "round") {
    return config.shape;
  }
  switch (config.productType) {
    case "cake":
    case "mousse_cake":
    case "tart":
    case "cheesecake":
      return "round";
    case "bento":
      return "square";
    default:
      return "other";
  }
}

/**
 * Главная точка входа: CakeBuilderConfig → CakeVisual.
 * Чистая функция — любые поля опциональны, невалидные значения деградируют
 * к дефолтам (пустой конфиг → стилизованная «other» заготовка).
 */
export function configToVisual(config: CakeBuilderConfig): CakeVisual {
  const cfg = config ?? {};

  const shape = resolveVisualShape(cfg);

  const tiers =
    (Number(cfg.tiers) >= 2 || Number(cfg.servings) >= TWO_TIER_SERVINGS_THRESHOLD) && shape !== "cupcakes"
      ? 2
      : 1;

  const decorIcons = Array.isArray(cfg.decorations)
    ? cfg.decorations
        .filter((d): d is string => typeof d === "string" && d.length > 0)
        .map((d) => DECOR_GLYPHS[d] ?? DECOR_GLYPH_FALLBACK)
        // уникализируем глифы: два одинаковых декора не удваиваются на превью
        .filter((glyph, idx, arr) => arr.indexOf(glyph) === idx)
        .slice(0, 5)
    : [];

  const rawInscription = typeof cfg.inscription === "string" ? cfg.inscription.trim() : "";
  const inscription =
    rawInscription.length > INSCRIPTION_MAX_LEN
      ? `${rawInscription.slice(0, INSCRIPTION_MAX_LEN - 1)}…`
      : rawInscription;

  return {
    shape,
    baseColor: pickColor(BASE_COLORS, cfg.base, DEFAULT_BASE_COLOR),
    fillingAccent: pickColor(FILLING_COLORS, cfg.filling, DEFAULT_FILLING_COLOR),
    coatingColor: pickColor(COATING_COLORS, cfg.coating, DEFAULT_COATING_COLOR),
    drip: cfg.coating === "mirror_glaze",
    decorIcons,
    inscription,
    tiers,
  };
}

/**
 * Контрастный цвет текста надписи поверх покрытия: на тёмном ганаше/
 * бордовой глазури — кремовый, на светлых покрытиях — бордо (фирменный).
 * Простая проверка яркости (luminance) hex-цвета.
 */
export function inscriptionColorOn(coatingColor: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(coatingColor)?.[1];
  if (!hex) return "#8b2635"; // неизвестный формат → светлый фон → бордо
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55 ? "#f7f1e3" : "#8b2635";
}
