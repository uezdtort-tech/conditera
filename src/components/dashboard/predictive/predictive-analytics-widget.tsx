"use client";

/**
 * PredictiveAnalyticsWidget — прогноз спроса для кондитера.
 *
 * Показывает:
 *   - 7-дневный прогноз заказов (BarChart)
 *   - Горячие дни (когда ожидается повышенный спрос)
 *   - Рекомендованные запасы ингредиентов
 *   - Insights (текстовые подсказки)
 *   - Тренд (% роста/падения)
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  TrendingUp, TrendingDown, Flame, Sparkles, Package, Brain,
  Loader2, Calendar, AlertCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/finance";

interface DayForecast {
  date: string;
  dayOfWeek: number;
  predictedOrders: number;
  predictedRevenue: number;
  confidence: number;
  isHoliday: boolean;
  holidayName?: string;
  isWeekend: boolean;
  isHot: boolean;
}

interface PredictionData {
  forecast: DayForecast[];
  insights: string[];
  recommendedStock: { item: string; unit: string; amount: number }[];
  trends: { category: string; count: number; percent: number }[];
  summary: {
    totalHistoricalOrders: number;
    avgPerDay: number;
    trendPercent: number;
    totalPredictedOrders: number;
    totalPredictedRevenue: number;
    confidence: number;
  };
  hotDays: string[];
}

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function PredictiveAnalyticsWidget() {
  const [data, setData] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/confectioner/predictions");
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold">Прогноз спроса (AI)</h3>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded animate-pulse" />
          <div className="h-20 bg-muted rounded animate-pulse" />
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const chartData = data.forecast.map((f) => ({
    day: DAY_LABELS[f.dayOfWeek],
    date: new Date(f.date).getDate(),
    orders: f.predictedOrders,
    revenue: f.predictedRevenue,
    isHot: f.isHot,
  }));

  const trendUp = data.summary.trendPercent > 0;
  const hotDaysCount = data.hotDays.length;

  return (
    <div className="space-y-4">
      {/* Header + summary */}
      <Card className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold">Прогноз спроса</h3>
              <Badge variant="outline" className="text-[10px] bg-purple-100 text-purple-700">
                AI · {data.summary.confidence}% точность
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              На основе {data.summary.totalHistoricalOrders} заказов за 90 дней
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] text-muted-foreground">Прогноз на 7 дней</div>
                <div className="text-lg font-bold">{data.summary.totalPredictedOrders}</div>
                <div className="text-[10px] text-muted-foreground">заказов</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Ожидаемая выручка</div>
                <div className="text-lg font-bold text-emerald-600">
                  {formatCurrency(data.summary.totalPredictedRevenue)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Тренд</div>
                <div className={`text-lg font-bold flex items-center gap-1 ${trendUp ? "text-emerald-600" : "text-red-600"}`}>
                  {trendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {trendUp ? "+" : ""}{data.summary.trendPercent}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Среднее в день</div>
                <div className="text-lg font-bold">{data.summary.avgPerDay}</div>
                <div className="text-[10px] text-muted-foreground">заказов</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* График прогноза */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Прогноз на 7 дней
          </h4>
          {hotDaysCount > 0 && (
            <Badge className="bg-orange-100 text-orange-800 text-[10px] gap-1">
              <Flame className="h-2.5 w-2.5" />
              {hotDaysCount} горячих дней
            </Badge>
          )}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.015 70)" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v: number, name: string) => {
                if (name === "orders") return [`${v} заказов`, "Прогноз"];
                return [formatCurrency(v), "Выручка"];
              }}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Bar dataKey="orders" radius={[6, 6, 0, 0]}>
              {chartData.map((entry, i) => (
                <Bar
                  key={i}
                  dataKey="orders"
                  fill={entry.isHot ? "#f97316" : "#7c3aed"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded bg-purple-600" /> обычный день
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded bg-orange-500" /> горячий день
          </span>
        </div>
      </Card>

      {/* Insights */}
      {data.insights.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Рекомендации AI
          </h4>
          <div className="space-y-2">
            {data.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-sm bg-amber-50/50 rounded p-2">
                <span className="text-xs">{insight}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Рекомендованные запасы */}
      <Card className="p-4">
        <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-primary" />
          Рекомендованные запасы на 7 дней
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.recommendedStock.map((item, i) => (
            <div key={i} className="border rounded-lg p-2">
              <div className="text-xs font-medium">{item.item}</div>
              <div className="text-sm font-bold text-primary">
                {item.amount} {item.unit}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Тренды по категориям */}
      {data.trends.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            Популярные категории
          </h4>
          <div className="space-y-2">
            {data.trends.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs w-24 truncate">{t.category}</span>
                <Progress value={t.percent} className="h-2 flex-1" />
                <span className="text-xs text-muted-foreground w-16 text-right">
                  {t.count} ({t.percent}%)
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
