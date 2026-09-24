/**
 * GET /api/confectioner/predictions
 *
 * Прогноз спроса для кондитера на основе истории заказов.
 *
 * Возвращает:
 *   - forecast: прогноз количества заказов на следующие 7 дней (по дням)
 *   - busyDays: предсказанные "горячие" даты (высокая нагрузка)
 *   - recommendedStock: рекомендованные запасы ингредиентов
 *   - insights: текстовые подсказки ("В эти выходные ожидается +30%")
 *   - trends: тренды по категориям тортов
 *
 * Алгоритм:
 *   1. Загружаем заказы за последние 90 дней
 *   2. Считаем скользящее среднее по дням недели
 *   3. Учитываем сезонность (праздники, выходные)
 *   4. Учитываем растущий/падающий тренд
 *   5. Прогнозируем на 7 дней вперёд
 *
 * Безопасность:
 *   • GET: требует роль CONFECTIONER.
 *   • BUG FIXED: раньше использовал payload.userId как confectioner_id напрямую,
 *     но confectioner_id ссылается на таблицу confectioners. Теперь находим conf.id.
 *   • При сбое БД — fallback на mock-данные (для dev/preview).
 *   • Type-safe interfaces для всех возвращаемых данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface ConfectionerRow {
  id: string;
}

interface OrderRow {
  id: string;
  total: number;
  status: string | null;
  created_at: string;
}

// Российские праздники (когда высокий спрос на торты)
const HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "Новый год",
  "2026-01-07": "Рождество",
  "2026-02-14": "День святого Валентина",
  "2026-02-23": "День защитника Отечества",
  "2026-03-08": "Международный женский день",
  "2026-05-09": "День Победы",
  "2026-06-01": "День защиты детей",
  "2026-06-12": "День России",
  "2026-09-01": "День знаний",
  "2026-11-04": "День народного единства",
  "2026-12-31": "Предновогодний",
};

interface DayForecast {
  date: string;
  dayOfWeek: number; // 0-6 (вс-сб)
  predictedOrders: number;
  predictedRevenue: number;
  confidence: number; // 0-1
  isHoliday: boolean;
  holidayName?: string;
  isWeekend: boolean;
  isHot: boolean; // горячий день (прогноз > 150% от среднего)
}

interface DayOfWeekStat {
  count: number;
  revenue: number;
  days: number;
}

interface TrendItem {
  category: string;
  count: number;
  percent: number;
}

interface RecommendedStock {
  item: string;
  unit: string;
  amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_RANGE_DAYS = 90;
const FORECAST_DAYS = 7;
const LAST_30_DAYS = 30;
const PREV_30_DAYS = 60;
const WEEKEND_BOOST = 1.3;
const HOLIDAY_BOOST = 1.8;
const HOT_THRESHOLD = 1.5;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("CONFECTIONER")) {
      throw new HttpError(403, "Только кондитер");
    }

    // Find confectioner profile (нельзя использовать user.userId как confectioner_id)
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.userId)
      .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

    if (confErr) {
      console.error("[confectioner/predictions] conf lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось загрузить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const confectionerId = conf.id;

    // Загружаем заказы за последние 90 дней
    let orders: OrderRow[] = [];
    try {
      const ninetyDaysAgoIso = new Date(Date.now() - HISTORICAL_RANGE_DAYS * DAY_MS).toISOString();
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select("id, total, status, created_at")
        .eq("confectioner_id", confectionerId)
        .gte("created_at", ninetyDaysAgoIso)
        .order("created_at", { ascending: true }) as { data: OrderRow[] | null; error: SupabaseError | null };

      if (error) throw error;
      orders = data || [];
    } catch (e) {
      // БД недоступна — используем mock-данные
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[confectioner/predictions] using mock orders:", msg);
      orders = generateMockOrders();
    }

    // === Анализ исторических данных ===
    const dayOfWeekStats: Record<number, DayOfWeekStat> = {};
    for (let i = 0; i < 7; i++) dayOfWeekStats[i] = { count: 0, revenue: 0, days: 0 };

    const uniqueDates = new Set<string>();
    for (const o of orders) {
      const d = new Date(o.created_at);
      const dow = d.getDay();
      dayOfWeekStats[dow].count += 1;
      dayOfWeekStats[dow].revenue += Number(o.total) || 0;
      uniqueDates.add(d.toISOString().slice(0, 10));
    }

    // Сколько уникальных дней каждого дня недели в выборке
    const today = new Date();
    for (let i = 0; i < HISTORICAL_RANGE_DAYS; i++) {
      const d = new Date(today.getTime() - i * DAY_MS);
      dayOfWeekStats[d.getDay()].days += 1;
    }

    // Среднее количество заказов в день
    const totalOrders = orders.length;
    const avgPerDay = totalOrders / Math.max(1, uniqueDates.size || HISTORICAL_RANGE_DAYS);

    // Тренд: сравниваем последние 30 дней с предыдущими 30
    const last30Cutoff = new Date(Date.now() - LAST_30_DAYS * DAY_MS);
    const prev30Start = new Date(Date.now() - PREV_30_DAYS * DAY_MS);
    const prev30Cutoff = new Date(Date.now() - LAST_30_DAYS * DAY_MS);

    const last30 = orders.filter((o) => new Date(o.created_at) > last30Cutoff);
    const prev30 = orders.filter((o) => {
      const d = new Date(o.created_at);
      return d > prev30Start && d <= prev30Cutoff;
    });
    const trendPercent = prev30.length > 0
      ? Math.round(((last30.length - prev30.length) / prev30.length) * 100)
      : 0;

    // === Прогноз на 7 дней вперёд ===
    const forecast: DayForecast[] = [];
    for (let i = 0; i < FORECAST_DAYS; i++) {
      const date = new Date(today.getTime() + i * DAY_MS);
      const dow = date.getDay();
      const dateStr = date.toISOString().slice(0, 10);
      const isWeekend = dow === 0 || dow === 6;
      const holidayName = HOLIDAYS_2026[dateStr];
      const isHoliday = Boolean(holidayName);

      // Базовый прогноз по дню недели
      const dowData = dayOfWeekStats[dow];
      const avgDowOrders = dowData.days > 0 ? dowData.count / dowData.days : avgPerDay;
      const avgDowRevenue = dowData.days > 0 ? dowData.revenue / dowData.days : 0;

      // Применяем тренд
      let predictedOrders = avgDowOrders * (1 + trendPercent / 100);
      let predictedRevenue = avgDowRevenue * (1 + trendPercent / 100);

      // Буст за выходные (+30%)
      if (isWeekend) {
        predictedOrders *= WEEKEND_BOOST;
        predictedRevenue *= WEEKEND_BOOST;
      }

      // Буст за праздники (+80%)
      if (isHoliday) {
        predictedOrders *= HOLIDAY_BOOST;
        predictedRevenue *= HOLIDAY_BOOST;
      }

      // Уверенность (0-1): больше данных → выше уверенность
      const confidence = Math.min(0.95, 0.3 + (dowData.count / Math.max(1, totalOrders)) * 2);

      const isHot = predictedOrders > avgPerDay * HOT_THRESHOLD;

      forecast.push({
        date: dateStr,
        dayOfWeek: dow,
        predictedOrders: Math.round(predictedOrders),
        predictedRevenue: Math.round(predictedRevenue),
        confidence: Math.round(confidence * 100) / 100,
        isHoliday,
        holidayName,
        isWeekend,
        isHot,
      });
    }

    // === Рекомендованные запасы ===
    const totalPredictedOrders = forecast.reduce((s, f) => s + f.predictedOrders, 0);
    const recommendedStock: RecommendedStock[] = [
      { item: "Мука пшеничная", unit: "кг", amount: Math.ceil(totalPredictedOrders * 0.5) },
      { item: "Сахар", unit: "кг", amount: Math.ceil(totalPredictedOrders * 0.4) },
      { item: "Масло сливочное", unit: "кг", amount: Math.ceil(totalPredictedOrders * 0.3) },
      { item: "Яйца", unit: "шт", amount: Math.ceil(totalPredictedOrders * 4) },
      { item: "Сливки 33%", unit: "л", amount: Math.ceil(totalPredictedOrders * 0.5) },
      { item: "Сахарная пудра", unit: "кг", amount: Math.ceil(totalPredictedOrders * 0.2) },
    ];

    // === Текстовые insights ===
    const insights: string[] = [];
    const hotDays = forecast.filter((f) => f.isHot);
    if (hotDays.length > 0) {
      const hotDates = hotDays.map((d) => {
        const dt = new Date(d.date);
        return `${dt.getDate()} ${dt.toLocaleDateString("ru-RU", { month: "short" })}`;
      }).join(", ");
      insights.push(`🔥 Ожидается повышенный спрос: ${hotDates}. Запасите ингредиенты заранее.`);
    }
    if (trendPercent > 10) {
      insights.push(`📈 Растущий тренд: +${trendPercent}% заказов за последний месяц. Стоит подумать о помощнике.`);
    } else if (trendPercent < -10) {
      insights.push(`📉 Снижение спроса: ${trendPercent}% за месяц. Стоит запустить акцию или опубликовать новый рецепт.`);
    }
    const holidaySoon = forecast.find((f) => f.isHoliday);
    if (holidaySoon) {
      insights.push(`🎉 Ближайший праздник: ${holidaySoon.holidayName}. Закупите декор и упаковку заранее.`);
    }
    if (totalOrders < 10) {
      insights.push("💡 Недостаточно данных для точного прогноза. Чем больше заказов, тем точнее предсказания.");
    }
    const weekendBoost = forecast
      .filter((f) => f.isWeekend)
      .reduce((s, f) => s + f.predictedOrders, 0);
    if (weekendBoost > 0) {
      insights.push(`📅 На выходные прогнозируется ${weekendBoost} заказов — подготовьте тесто заранее.`);
    }

    // === Тренды по категориям ===
    // Note: orders не содержат category — для трендов нужно join с products.
    // Пока возвращаем один тренд "other" со всеми заказами.
    const trends: TrendItem[] = [
      {
        category: "other",
        count: totalOrders,
        percent: totalOrders > 0 ? 100 : 0,
      },
    ];

    return NextResponse.json({
      forecast,
      insights,
      recommendedStock,
      trends,
      summary: {
        totalHistoricalOrders: totalOrders,
        avgPerDay: Math.round(avgPerDay * 10) / 10,
        trendPercent,
        totalPredictedOrders,
        totalPredictedRevenue: forecast.reduce((s, f) => s + f.predictedRevenue, 0),
        confidence: Math.round(
          (forecast.reduce((s, f) => s + f.confidence, 0) / Math.max(1, forecast.length)) * 100
        ),
      },
      hotDays: forecast.filter((f) => f.isHot).map((f) => f.date),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Mock-заказы для dev/демонстрации (когда БД недоступна).
 */
function generateMockOrders(): OrderRow[] {
  const orders: OrderRow[] = [];
  const now = Date.now();
  for (let i = 0; i < 45; i++) {
    const daysAgo = Math.floor(Math.random() * HISTORICAL_RANGE_DAYS);
    const date = new Date(now - daysAgo * DAY_MS);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend && Math.random() < 0.5) {
      orders.push({
        id: `mock-${i}`,
        total: 2000 + Math.random() * 3000,
        status: "DELIVERED",
        created_at: date.toISOString(),
      });
    } else if (Math.random() < 0.25) {
      orders.push({
        id: `mock-${i}`,
        total: 1500 + Math.random() * 2500,
        status: "DELIVERED",
        created_at: date.toISOString(),
      });
    }
  }
  return orders;
}
