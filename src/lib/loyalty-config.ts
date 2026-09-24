/**
 * Loyalty program configuration — client-safe (no DB imports).
 *
 * Safe to import from Client Components. Server-side logic that needs DB
 * access lives in `loyalty.ts` and is only imported from API routes.
 */
export type LoyaltyLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

export interface LevelConfig {
  name: string;
  minSpent: number;
  discount: number; // % cashback on orders
  multiplier: number; // points multiplier
  color: string;
  perks: string[];
}

export const LEVELS: Record<LoyaltyLevel, LevelConfig> = {
  BRONZE: {
    name: "Бронзовый",
    minSpent: 0,
    discount: 0,
    multiplier: 1,
    color: "#a16207",
    perks: [
      "Базовое начисление бонусов (1 балл за 100 ₽)",
      "Доступ к акциям и промокодам",
      "Поздравление с днем рождения",
    ],
  },
  SILVER: {
    name: "Серебряный",
    minSpent: 5000,
    discount: 3,
    multiplier: 1.2,
    color: "#64748b",
    perks: [
      "+20% к начислению бонусов",
      "Кэшбек 3% баллами с каждого заказа",
      "Приоритетная поддержка",
      "Бесплатная доставка от 2000 ₽",
    ],
  },
  GOLD: {
    name: "Золотой",
    minSpent: 15000,
    discount: 5,
    multiplier: 1.5,
    color: "#d4af37",
    perks: [
      "+50% к начислению бонусов",
      "Кэшбек 5% баллами с каждого заказа",
      "Ранний доступ к новинкам кондитеров",
      "Бесплатная доставка от 1500 ₽",
      "Подарок в день рождения (бонус 1000)",
    ],
  },
  PLATINUM: {
    name: "Платиновый",
    minSpent: 50000,
    discount: 10,
    multiplier: 2,
    color: "#7c3aed",
    perks: [
      "×2 к начислению бонусов",
      "Кэшбек 10% баллами с каждого заказа",
      "Персональный менеджер",
      "Бесплатная доставка от 1000 ₽",
      "Эксклюзивные дегустации",
      "Подарок в день рождения (бонус 2500)",
      "Бесплатная упаковка премиум",
    ],
  },
};

export const POINTS_PER_RUBBLE = 1 / 100; // 1 балл за 100 ₽
export const POINT_TO_RUBLE_RATE = 1; // 1 балл = 1 ₽ скидки
export const MIN_REDEMPTION_POINTS = 100; // мин. 100 баллов к списыванию
export const MAX_REDEMPTION_PERCENT = 50; // макс. 50% стоимости заказа можно оплатить баллами
export const POINTS_EXPIRE_MONTHS = 12; // баллы сгорают через 12 месяцев без активности

export function getLevelForSpent(totalSpent: number): LoyaltyLevel {
  if (totalSpent >= LEVELS.PLATINUM.minSpent) return "PLATINUM";
  if (totalSpent >= LEVELS.GOLD.minSpent) return "GOLD";
  if (totalSpent >= LEVELS.SILVER.minSpent) return "SILVER";
  return "BRONZE";
}

export function getNextLevel(level: LoyaltyLevel): LoyaltyLevel | null {
  const order: LoyaltyLevel[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];
  const i = order.indexOf(level);
  return i < order.length - 1 ? order[i + 1] : null;
}

/**
 * Calculate points earned for a purchase.
 * Includes level multiplier + cashback bonus.
 */
export function calculateEarnedPoints(
  amount: number,
  level: LoyaltyLevel
): number {
  const base = Math.floor(amount * POINTS_PER_RUBBLE);
  const cashbackBonus = Math.floor((amount * LEVELS[level].discount) / 100);
  return Math.floor((base + cashbackBonus) * LEVELS[level].multiplier);
}

/**
 * Calculate max points that can be redeemed for an order of this amount.
 */
export function calculateMaxRedeemable(amount: number, balance: number): number {
  const capByPercent = Math.floor((amount * MAX_REDEMPTION_PERCENT) / 100);
  return Math.min(balance, capByPercent, Math.floor(amount / POINT_TO_RUBLE_RATE));
}

export function formatPoints(points: number): string {
  const n = Math.abs(points);
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${points} баллов`;
  if (last === 1) return `${points} балл`;
  if (last >= 2 && last <= 4) return `${points} балла`;
  return `${points} баллов`;
}
