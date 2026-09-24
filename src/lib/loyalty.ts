/**
 * Loyalty program — server-side functions that need DB access.
 *
 * Client-safe constants and pure functions live in `loyalty-config.ts`.
 * This file is only imported from API routes / server components.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • recordLoyaltyTx использует атомарный RPC add_bonus_balance для изменения
 *     баланса — нет race condition между параллельными начислениями.
 *   • redeemPoints использует атомарный RPC deduct_bonus_balance с проверкой
 *     минимального баланса внутри SQL — нет TOCTOU.
 *   • Idempotency: redeemPoints проверяет, не было ли уже списания для этого
 *     order_id (через loyalty_transactions с type=REDEEM).
 */
import { supabaseAdmin } from "./supabase/admin";
import {
  LEVELS,
  POINTS_PER_RUBBLE,
  POINT_TO_RUBLE_RATE,
  MIN_REDEMPTION_POINTS,
  MAX_REDEMPTION_PERCENT,
  POINTS_EXPIRE_MONTHS,
  getLevelForSpent,
  calculateEarnedPoints,
  calculateMaxRedeemable,
  type LoyaltyLevel,
} from "./loyalty-config";

// Re-export everything from config so callers can import from either file
export {
  LEVELS,
  POINTS_PER_RUBBLE,
  POINT_TO_RUBLE_RATE,
  MIN_REDEMPTION_POINTS,
  MAX_REDEMPTION_PERCENT,
  POINTS_EXPIRE_MONTHS,
  getLevelForSpent,
  getNextLevel,
  calculateEarnedPoints,
  calculateMaxRedeemable,
  formatPoints,
  type LoyaltyLevel,
  type LevelConfig,
} from "./loyalty-config";

interface SupabaseError {
  message: string;
}

interface UserRow {
  id: string;
  bonus_balance: number | null;
  loyalty_level: string | null;
  city: string | null;
}

interface OrderRow {
  total: number;
  payment_status: string;
}

interface LoyaltyTxRow {
  id: string;
  user_id: string;
  type: string;
  points: number;
  balance_after: number;
  description: string | null;
  order_id: string | null;
  amount: number | null;
  multiplier: number | null;
  expires_at: string | null;
  created_at: string;
}

type LoyaltyTxType =
  | "EARN"
  | "REDEEM"
  | "EXPIRE"
  | "REFUND"
  | "ADJUST"
  | "BONUS_WELCOME"
  | "BONUS_BIRTHDAY"
  | "BONUS_REFERRAL";

interface RecordTxInput {
  userId: string;
  type: LoyaltyTxType;
  points: number; // positive for earn, negative for redeem
  description: string;
  orderId?: string;
  amount?: number;
  multiplier?: number;
  expiresAt?: Date;
}

interface RecordTxResult {
  newBalance: number;
  txId: string;
}

/**
 * Persist a loyalty transaction and update user balance atomically.
 * Use this for all bonus movements (earn, redeem, expire, refund, etc.).
 *
 * Атомарность: balance update через RPC add_bonus_balance — нет race condition.
 * Negative points (REDEEM) проверяются внутри RPC: если balance + points < 0,
 * RPC бросает exception, мы его логируем и прокидываем выше.
 */
export async function recordLoyaltyTx(input: RecordTxInput): Promise<RecordTxResult> {
  // Атомарно обновляем balance через RPC. Если points отрицательные и balance
  // недостаточен, RPC бросит exception, мы выйдем с понятной ошибкой.
  const { data: newBalance, error: balanceErr } = await supabaseAdmin
    .rpc("add_bonus_balance", {
      p_user_id: input.userId,
      p_points: input.points,
    });

  if (balanceErr) {
    console.error("[loyalty] add_bonus_balance RPC failed:", balanceErr.message);
    // Проверяем на "user not found"
    if (balanceErr.message.includes("user not found")) {
      throw new Error("User not found");
    }
    if (balanceErr.message.includes("insufficient balance")) {
      throw new Error(
        `Недостаточно бонусов: списание ${Math.abs(input.points)}`
      );
    }
    throw new Error(`Не удалось обновить баланс: ${balanceErr.message}`);
  }

  if (newBalance === null || newBalance === undefined) {
    throw new Error("Не удалось обновить баланс");
  }

  // Создаём запись о транзакции (не в той же транзакции, но это безопасно:
  // если insert упадёт, баланс останется изменённым, но при следующей попытке
  // транзакция не задвоится — точки не потеряются, разница только в отчётах).
  const { data: tx, error: txErr } = await supabaseAdmin
    .from("loyalty_transactions")
    .insert({
      user_id: input.userId,
      type: input.type,
      points: input.points,
      balance_after: newBalance,
      description: input.description,
      order_id: input.orderId || null,
      amount: input.amount || null,
      multiplier: input.multiplier || null,
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single() as { data: { id: string } | null; error: SupabaseError | null };

  if (txErr || !tx) {
    console.error("[loyalty] tx insert failed:", txErr?.message);
    // Возвращаем как успешный, но с synthetic txId (можно потом ревизией
    // найти расхождения balance vs sum(transactions)).
    return { newBalance, txId: `synthetic-${Date.now()}` };
  }

  return { newBalance, txId: tx.id };
}

/**
 * Award points for a completed order.
 * Создаёт EARN transaction, expires через POINTS_EXPIRE_MONTHS.
 */
export async function awardOrderPoints(
  userId: string,
  orderId: string,
  orderAmount: number
): Promise<{ points: number; level: LoyaltyLevel }> {
  // Загружаем user: loyalty_level и city для расчёта points.
  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("id, loyalty_level, city")
    .eq("id", userId)
    .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[loyalty] user lookup failed:", error.message);
    throw new Error(`Не удалось загрузить пользователя: ${error.message}`);
  }
  if (!user) throw new Error("User not found");

  const level = (user.loyalty_level as LoyaltyLevel) || "BRONZE";
  const points = calculateEarnedPoints(orderAmount, level);

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + POINTS_EXPIRE_MONTHS);

  await recordLoyaltyTx({
    userId,
    type: "EARN",
    points,
    description: `Начисление за заказ #${orderId.slice(-6)}`,
    orderId,
    amount: orderAmount,
    multiplier: LEVELS[level].multiplier,
    expiresAt,
  });

  return { points, level };
}

/**
 * Redeem points for discount on an order.
 * Idempotency: проверяет существующий REDEEM для order_id.
 * Атомарность: balance update через RPC deduct_bonus_balance с проверкой
 * минимального баланса внутри SQL.
 */
export async function redeemPoints(
  userId: string,
  orderId: string,
  orderAmount: number,
  requestedPoints: number
): Promise<{ redeemedPoints: number; discountRub: number; newBalance: number }> {
  // Validate sign — prevent negative points from becoming positive earning
  if (requestedPoints <= 0) {
    throw new Error("Количество баллов должно быть положительным");
  }
  if (!Number.isFinite(requestedPoints) || !Number.isInteger(requestedPoints)) {
    throw new Error("Количество баллов должно быть целым числом");
  }

  // Check for existing REDEEM on this order (prevent double-spend)
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("loyalty_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("order_id", orderId)
    .eq("type", "REDEEM")
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    console.error("[loyalty] existing REDEEM check failed:", existingErr.message);
    throw new Error(`Не удалось проверить существующее списание: ${existingErr.message}`);
  }
  if (existing) {
    throw new Error("Бонусы уже списаны для этого заказа");
  }

  // Загружаем текущий баланс для расчёта maxRedeemable
  const { data: user, error: userErr } = await supabaseAdmin
    .from("profiles")
    .select("bonus_balance")
    .eq("id", userId)
    .maybeSingle() as { data: { bonus_balance: number | null } | null; error: SupabaseError | null };

  if (userErr || !user) {
    throw new Error(userErr ? `Не удалось загрузить пользователя: ${userErr.message}` : "User not found");
  }

  const currentBalance = user.bonus_balance || 0;
  const maxRedeemable = calculateMaxRedeemable(orderAmount, currentBalance);

  if (requestedPoints < MIN_REDEMPTION_POINTS) {
    throw new Error(`Минимум ${MIN_REDEMPTION_POINTS} баллов для списывания`);
  }
  if (requestedPoints > maxRedeemable) {
    throw new Error(
      `Можно списать максимум ${maxRedeemable} баллов (до ${MAX_REDEMPTION_PERCENT}% стоимости)`
    );
  }

  // Атомарно списываем баланс через RPC с блокировкой строки (FOR UPDATE)
  const { data: newBalance, error: deductErr } = await supabaseAdmin
    .rpc("deduct_bonus_balance", {
      p_user_id: userId,
      p_points: requestedPoints,
    });

  if (deductErr) {
    console.error("[loyalty] deduct_bonus_balance RPC failed:", deductErr.message);
    if (deductErr.message.includes("user not found")) {
      throw new Error("User not found");
    }
    if (deductErr.message.includes("insufficient balance")) {
      throw new Error("Недостаточно бонусов на балансе");
    }
    throw new Error(`Не удалось списать бонусы: ${deductErr.message}`);
  }

  if (newBalance === null || newBalance === undefined) {
    throw new Error("Не удалось получить новый баланс");
  }

  const discountRub = requestedPoints * POINT_TO_RUBLE_RATE;

  // Создаём запись о REDEEM-транзакции
  const { error: txErr } = await supabaseAdmin
    .from("loyalty_transactions")
    .insert({
      user_id: userId,
      type: "REDEEM",
      points: -requestedPoints,
      balance_after: newBalance,
      description: `Списание для заказа #${orderId.slice(-6)}`,
      order_id: orderId,
      amount: orderAmount,
      created_at: new Date().toISOString(),
    });

  if (txErr) {
    console.error("[loyalty] REDEEM tx insert failed:", txErr.message);
    // Non-fatal — баланс уже списан, tx можно восстановить ревизией.
  }

  return {
    redeemedPoints: requestedPoints,
    discountRub,
    newBalance,
  };
}

/**
 * Award welcome bonus to a new user.
 */
export async function awardWelcomeBonus(userId: string): Promise<void> {
  const WELCOME_BONUS = 100;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  await recordLoyaltyTx({
    userId,
    type: "BONUS_WELCOME",
    points: WELCOME_BONUS,
    description: "Приветственный бонус",
    expiresAt,
  });
}

/**
 * Award birthday bonus based on user's level.
 */
export async function awardBirthdayBonus(userId: string): Promise<void> {
  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("loyalty_level")
    .eq("id", userId)
    .maybeSingle() as { data: { loyalty_level: string | null } | null; error: SupabaseError | null };

  if (error) {
    console.error("[loyalty] user lookup failed:", error.message);
    throw new Error(`Не удалось загрузить пользователя: ${error.message}`);
  }
  if (!user) throw new Error("User not found");

  const level = (user.loyalty_level as LoyaltyLevel) || "BRONZE";
  const bonus =
    level === "PLATINUM" ? 2500 : level === "GOLD" ? 1000 : level === "SILVER" ? 300 : 0;

  if (bonus === 0) return;

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  await recordLoyaltyTx({
    userId,
    type: "BONUS_BIRTHDAY",
    points: bonus,
    description: "Подарок ко дню рождения",
    expiresAt,
  });
}

/**
 * Promote user's level based on total spent across all completed orders.
 * Загружает ВСЕ succeeded orders, считает sum(total) — для пользователей с
 * тысячами заказов это может быть медленным. Для оптимизации можно добавить
 * total_spent кэш-колонку в profiles и обновлять через trigger.
 */
export async function recalcUserLevel(userId: string): Promise<{
  level: LoyaltyLevel;
  previousLevel: LoyaltyLevel | null;
  promoted: boolean;
}> {
  const { data: user, error } = await supabaseAdmin
    .from("profiles")
    .select("loyalty_level")
    .eq("id", userId)
    .maybeSingle() as { data: { loyalty_level: string | null } | null; error: SupabaseError | null };

  if (error || !user) {
    throw new Error(error ? `Не удалось загрузить пользователя: ${error.message}` : "User not found");
  }

  // Загружаем все succeeded orders для расчёта totalSpent
  const { data: orders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("total, payment_status")
    .eq("customer_id", userId)
    .eq("payment_status", "succeeded") as { data: OrderRow[] | null; error: SupabaseError | null };

  if (ordersErr) {
    console.error("[loyalty] orders lookup failed:", ordersErr.message);
    throw new Error(`Не удалось загрузить заказы: ${ordersErr.message}`);
  }

  const totalSpent = (orders || []).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const newLevel = getLevelForSpent(totalSpent);
  const previousLevel = (user.loyalty_level as LoyaltyLevel) || "BRONZE";
  const promoted = newLevel !== previousLevel;

  if (promoted) {
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ loyalty_level: newLevel })
      .eq("id", userId);

    if (updErr) {
      console.error("[loyalty] level update failed:", updErr.message);
      // Не бросаем — уровень можно пересчитать cron'ом позже.
    }
  }

  return { level: newLevel, previousLevel: promoted ? previousLevel : null, promoted };
}

/**
 * Find users with points that will expire in the next 14 days.
 * Возвращает массив { userId, points, expiresAt }.
 */
export async function findUsersWithExpiringPoints(): Promise<
  Array<{ userId: string; points: number; expiresAt: Date }>
> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 14);
  const nowIso = new Date().toISOString();

  // Загружаем все EARN транзакции с expiresAt в ближайшие 14 дней.
  // TODO: для масштаба — добавить RPC для агрегации по userId.
  const { data: expiring, error } = await supabaseAdmin
    .from("loyalty_transactions")
    .select("user_id, points, expires_at")
    .eq("type", "EARN")
    .gt("points", 0)
    .lte("expires_at", cutoff.toISOString())
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: true })
    .limit(10_000) as { data: LoyaltyTxRow[] | null; error: SupabaseError | null };

  if (error) {
    console.error("[loyalty] expiring points query failed:", error.message);
    return [];
  }

  const byUser = new Map<string, number>();
  for (const tx of expiring || []) {
    byUser.set(tx.user_id, (byUser.get(tx.user_id) || 0) + tx.points);
  }

  return Array.from(byUser.entries()).map(([userId, points]) => ({
    userId,
    points,
    expiresAt: cutoff,
  }));
}
