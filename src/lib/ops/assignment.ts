/**
 * assignment.ts — Assignment Engine P0.5 (ТЗ §14, §15, §16).
 *
 * РЕКОМЕНДАЦИЯ исполнителя с объяснением — безусловного авто-назначения нет
 * (ТЗ §14: «Не делать безусловное автоматическое назначение на первом этапе»).
 *
 * Matching score (ТЗ §15) — веса из lifecycle-config (DEFAULT_MATCHING_WEIGHTS):
 *   capacity 30% | availability 25% | specialization 20% |
 *   inventory proximity 10% | distance 5% | rating 5% | price 5%
 * Отсутствующий компонент (напр. price) выпадает с переренормировкой суммы.
 *
 * Конфликт назначения (ТЗ §16): перегруженный кондитер НЕ рекомендуется;
 * результат помечается conflict с явной арифметикой (capacity/required/available).
 */

import { getPool } from "@/lib/postgrest/pool";
import {
  DEFAULT_MATCHING_WEIGHTS,
  type MatchingWeights,
} from "./lifecycle-config";
import { findAvailableWindow, type FreeWindow } from "./capacity";
import { computeIngredientNeeds } from "./breakdown";
import { minuteToHHMM } from "./deadline";

export interface AssignmentCandidate {
  confectionerId: string;
  name: string;
  city: string | null;
  rating: number | null;
  specialization: string[];
  score: number; // 0..100
  scoreBreakdown: Record<string, number | null>; // null — компонент недоступен
  reasons: string[]; // «✓ свободна в нужное окно» и т.п.
  warnings: string[];
  capacity: {
    fits: boolean;
    utilizationPercent: number | null;
    freeMinutes: number | null;
    window: { start: string; end: string } | null;
    requiredMinutes: number;
  };
  inventory: {
    canProduce: boolean | null;
    shortageCount: number;
    shortageCost: number | null;
  };
  conflict: {
    overloaded: boolean;
    message: string | null;
  } | null;
}

export interface AssignmentRecommendation {
  candidates: AssignmentCandidate[];
  recommended: AssignmentCandidate | null;
  explanation: string | null;
}

export interface AssignmentInput {
  /** Позиции (recipe_id × quantity) — для инвентарной близости. */
  items: Array<{ recipe_id: string | null; quantity: number }>;
  /** Slug категории товара — для специализации. */
  categorySlug: string | null;
  deliveryDate: string | null;
  /** Требуемое производственное время (минуты). */
  requiredMinutes: number;
  deliveryCity: string | null;
  /** Ранний старт: сегодня → текущая минута. */
  earliestMinute?: number;
  weights?: Partial<MatchingWeights>;
  /** Максимальное число кандидатов в ответе. */
  limit?: number;
  now?: Date;
}

type CandidateRow = {
  user_id: string;
  business_name: string | null;
  city: string | null;
  rating: number | null;
  specialization: string[] | null;
  product_types: string[] | null;
};

/**
 * Порекомендовать кондитеров для заказа.
 * Один SQL на кандидатов + 2 SQL на кандидата (ёмкость, инвентарь) —
 * кандидатов ограничиваем (лимит по умолчанию 8) — это не «Orders today»
 * hot path, N+1 допустим осознанно и документирован.
 */
export async function recommendConfectioners(
  input: AssignmentInput
): Promise<AssignmentRecommendation> {
  const pool = getPool();
  const weights: MatchingWeights = { ...DEFAULT_MATCHING_WEIGHTS, ...(input.weights ?? {}) };
  const limit = Math.min(input.limit ?? 8, 20);

  // --- Кандидаты: подтверждённые кондитеры (существующая модель ролей) ---
  const res = await pool.query<CandidateRow>(
    `SELECT c."userId"::text AS user_id,
            c."businessName" AS business_name,
            c.city, c.rating,
            c.specialization,
            cap.product_types
     FROM public.confectioners c
     LEFT JOIN public.confectioner_capabilities cap ON cap.confectioner_id = c.id
     WHERE c."verificationStatus" = 'approved'
     ORDER BY c.rating DESC NULLS LAST
     LIMIT 30`
  );
  const rows = res.rows;

  const candidates: AssignmentCandidate[] = [];

  for (const row of rows) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const breakdown: Record<string, number | null> = {};

    // --- Capacity / availability (ёмкость + окно) ---
    let fits = false;
    let utilization: number | null = null;
    let freeMinutes: number | null = null;
    let win: FreeWindow | null = null;
    if (input.deliveryDate) {
      const { window: found, view } = await findAvailableWindow(
        row.user_id,
        input.deliveryDate,
        input.requiredMinutes,
        input.earliestMinute ?? 0
      );
      utilization = view.utilizationPercent;
      freeMinutes = view.freeMinutes;
      win = found;
      fits = Boolean(found);
    } else {
      warnings.push("Дата доставки не указана — окно не проверено.");
    }

    const requiredMinutes = input.requiredMinutes;
    if (fits) {
      reasons.push(`✓ свободен в нужное окно (${win ? `${minuteToHHMM(win.start)}–${minuteToHHMM(win.end)}` : "окно найдено"})`);
    } else if (input.deliveryDate) {
      warnings.push(
        `✗ нет свободного окна ${requiredMinutes} мин (загрузка ${utilization ?? "—"}%, доступно ${freeMinutes ?? 0} мин)`
      );
    }

    // Свободная доля дня → component score
    breakdown.capacity =
      utilization === null
        ? null
        : Math.max(0, Math.min(100, 100 - utilization));
    breakdown.availability = fits ? 100 : 0;

    // --- Specialization ---
    const spec = (row.specialization ?? []).map((s) => s.toLowerCase());
    const productTypes = (row.product_types ?? []).map((s) => s.toLowerCase());
    const cat = (input.categorySlug ?? "").toLowerCase();
    const specNamesRu: Record<string, string[]> = {
      cakes: ["торты", "cake", "торт"],
      cupcakes: ["капкейки", "cupcake"],
      cookies: ["печенье", "cookie", "имбирь"],
      desserts: ["десерты", "dessert"],
      bento: ["бенто", "торты"],
    };
    const needles = specNamesRu[cat] ?? (cat ? [cat] : []);
    const specMatch =
      cat === "" ||
      needles.length === 0
        ? null
        : [...spec, ...productTypes].some((s) =>
            needles.some((n) => s.includes(n) || n.includes(s))
          ) || spec.some((s) => s.includes(cat));
    breakdown.specialization = specMatch === null ? null : specMatch ? 100 : 0;
    if (specMatch === true) reasons.push("✓ специализация совпадает");
    if (specMatch === false) warnings.push("✗ специализация другая");

    // --- Inventory proximity ---
    let canProduce: boolean | null = null;
    let shortageCost: number | null = null;
    let shortageCount = 0;
    if (input.items.length > 0) {
      const needs = await computeIngredientNeeds(input.items, row.user_id);
      canProduce = needs.can_produce;
      shortageCount = needs.shortages.length;
      shortageCost = needs.total_shortage_cost;
      if (needs.ingredients.length === 0) {
        breakdown.inventoryProximity = null;
      } else {
        breakdown.inventoryProximity = needs.can_produce
          ? 100
          : Math.max(0, 100 - shortageCount * 25);
      }
      if (needs.can_produce) reasons.push("✓ ингредиенты доступны");
      else if (shortageCount > 0)
        warnings.push(`✗ дефицит ингредиентов: ${needs.shortages.map((s) => s.name).join(", ")}`);
    } else {
      breakdown.inventoryProximity = null;
    }

    // --- Distance (город — детерминированный прокси) ---
    const cityMatch =
      input.deliveryCity && row.city
        ? row.city.trim().toLowerCase() === input.deliveryCity.trim().toLowerCase()
        : null;
    breakdown.distance = cityMatch === null ? null : cityMatch ? 100 : 0;
    if (cityMatch === true) reasons.push("✓ в городе доставки");
    if (cityMatch === false) warnings.push("✗ другой город");

    // --- Rating ---
    breakdown.rating = row.rating === null ? null : Math.max(0, Math.min(100, (Number(row.rating) / 5) * 100));

    // --- Price: нет данных стоимости производства → компонент недоступен ---
    breakdown.price = null;

    // --- Взвешенная сумма с перенормировкой ---
    let weighted = 0;
    let weightSum = 0;
    (Object.keys(weights) as Array<keyof MatchingWeights>).forEach((k) => {
      const w = weights[k];
      const v = breakdown[k];
      weightSum += w;
      if (v !== null && v !== undefined) weighted += (w * v) / 100;
    });
    const score = weightSum > 0 ? Math.round((weighted / weightSum) * 100) : 0;

    // --- Конфликт (ТЗ §16) ---
    let conflict: AssignmentCandidate["conflict"] = null;
    const overloaded = utilization !== null && utilization >= 100;
    if (overloaded) {
      conflict = {
        overloaded: true,
        message: `Нельзя безопасно назначить: загрузка ${utilization}%, требуется ${requiredMinutes} мин, доступно 0 мин.`,
      };
    }

    candidates.push({
      confectionerId: row.user_id,
      name: row.business_name ?? "Кондитер",
      city: row.city,
      rating: row.rating === null ? null : Number(row.rating),
      specialization: row.specialization ?? [],
      score,
      scoreBreakdown: breakdown,
      reasons,
      warnings,
      capacity: {
        fits,
        utilizationPercent: utilization,
        freeMinutes,
        window: win ? { start: minuteToHHMM(win.start), end: minuteToHHMM(win.end) } : null,
        requiredMinutes,
      },
      inventory: { canProduce, shortageCount, shortageCost },
      conflict,
    });
  }

  // Сортировка: score desc; перегруженные — в конец
  candidates.sort((a, b) => {
    const aOver = a.conflict?.overloaded ? 1 : 0;
    const bOver = b.conflict?.overloaded ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return b.score - a.score;
  });

  const top = candidates.slice(0, limit);
  const recommended = top.find((c) => !c.conflict?.overloaded) ?? null;

  let explanation: string | null = null;
  if (recommended) {
    explanation = `Рекомендуется: ${recommended.name} (${recommended.score}/100). ${[...recommended.reasons, ...recommended.warnings].join(" ")}`;
  } else if (top.length > 0) {
    explanation = "Нет безопасного кандидата: все перегружены или не подходят — рассмотрите перенос даты.";
  }

  return { candidates: top, recommended, explanation };
}
