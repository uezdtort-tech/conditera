"use client";

/**
 * loyalty-partner-dashboard.tsx — дашборд для роли LOYALTY_PARTNER.
 *
 * Функциональность:
 *   - Обзор: KPI (активных акций, использований за месяц, всего партнёров, бонусных обменов)
 *   - Профиль компании: редактирование контактных данных + статус верификации
 *   - Кросс-акции: список + создание новых акций
 *   - Обмен бонусами: история обменов с внешними системами
 *   - Аналитика: эффективность акций (usage_count vs usage_limit)
 *
 * Использует:
 *   - @tanstack/react-query для кэширования данных
 *   - supabaseBrowser для запросов (RLS по user_id в loyalty_partners)
 *   - shadcn/ui компоненты
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Gift, Building2, TrendingUp, RefreshCw, Settings, Plus,
  CheckCircle2, XCircle, Clock, Edit3, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DashboardShell, LoadingState, ErrorState, StatCard, EmptyState,
} from "@/components/dashboard/_shared";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type {
  LoyaltyPartner, LoyaltyCrossAction, LoyaltyPointExchange,
} from "@/lib/supabase/types";

const TABS = [
  { id: "overview", label: "Обзор", icon: TrendingUp },
  { id: "profile", label: "Профиль", icon: Building2 },
  { id: "actions", label: "Кросс-акции", icon: Gift },
  { id: "exchanges", label: "Обмен бонусами", icon: RefreshCw },
  { id: "settings", label: "Настройки", icon: Settings },
];

const COMPANY_TYPES: Array<{
  value: LoyaltyPartner["company_type"];
  label: string;
}> = [
  { value: "bank", label: "Банк" },
  { value: "insurance", label: "Страховая" },
  { value: "coffee_chain", label: "Сеть кофеен" },
  { value: "restaurant_chain", label: "Сеть ресторанов" },
  { value: "retail", label: "Ритейл" },
  { value: "other", label: "Другое" },
];

const DISCOUNT_TYPES: Array<{
  value: LoyaltyCrossAction["discount_type"];
  label: string;
}> = [
  { value: "percent", label: "Процент" },
  { value: "fixed", label: "Фиксированная сумма" },
  { value: "bonus_points", label: "Бонусные баллы" },
  { value: "freebie", label: "Бесплатный подарок" },
];

interface PartnerStats {
  activeActions: number;
  totalUsages: number;
  totalExchanges: number;
  pointsExchanged: number;
  actionsByType: Array<{ type: string; count: number }>;
  usageByMonth: Array<{ month: string; count: number }>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Загрузить профиль текущего партнёра.
 */
function usePartnerProfile() {
  return useQuery<LoyaltyPartner | null>({
    queryKey: ["loyalty-partner", "profile"],
    queryFn: async () => {
      // RLS вернёт только запись текущего пользователя
      const { data, error } = await supabaseBrowser
        .from("loyalty_partners")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data || null) as LoyaltyPartner | null;
    },
  });
}

/**
 * Загрузить свои кросс-акции.
 */
function useCrossActions() {
  return useQuery<LoyaltyCrossAction[]>({
    queryKey: ["loyalty-partner", "cross-actions"],
    queryFn: async () => {
      // Сначала найти partner_id текущего пользователя
      const { data: partner } = await supabaseBrowser
        .from("loyalty_partners")
        .select("id")
        .maybeSingle();
      if (!partner) return [];

      const { data, error } = await supabaseBrowser
        .from("loyalty_cross_actions")
        .select("*")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as LoyaltyCrossAction[];
    },
  });
}

/**
 * Загрузить обмены бонусами.
 */
function usePointExchanges() {
  return useQuery<LoyaltyPointExchange[]>({
    queryKey: ["loyalty-partner", "exchanges"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("loyalty_point_exchanges")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data || []) as LoyaltyPointExchange[];
    },
  });
}

/**
 * Создать новую кросс-акцию через API route.
 */
function useCreateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      partner_id: string;
      title: string;
      description: string;
      discount_type: LoyaltyCrossAction["discount_type"];
      discount_value: number;
      start_at: string;
      end_at: string;
      usage_limit?: number | null;
    }) => {
      const response = await fetch("/api/loyalty/cross-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loyalty-partner"] });
      toast.success("Кросс-акция создана");
    },
    onError: (err: Error) => {
      toast.error("Ошибка создания акции", { description: err.message });
    },
  });
}

function computeStats(
  actions: LoyaltyCrossAction[],
  exchanges: LoyaltyPointExchange[]
): PartnerStats {
  const activeActions = actions.filter((a) => a.is_active).length;
  const totalUsages = actions.reduce((sum, a) => sum + (a.usage_count || 0), 0);
  const totalExchanges = exchanges.length;
  const pointsExchanged = exchanges.reduce(
    (sum, e) => sum + (e.direction === "from_partner" ? e.points_amount : 0),
    0
  );

  // По типам скидок
  const typeMap = new Map<string, number>();
  for (const a of actions) {
    typeMap.set(a.discount_type, (typeMap.get(a.discount_type) || 0) + 1);
  }

  // По месяцам (за год)
  const monthMap = new Map<string, number>();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    monthMap.set(key, 0);
  }
  for (const e of exchanges) {
    const d = new Date(e.created_at);
    const key = d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    if (monthMap.has(key)) monthMap.set(key, (monthMap.get(key) || 0) + 1);
  }

  return {
    activeActions,
    totalUsages,
    totalExchanges,
    pointsExchanged,
    actionsByType: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
    usageByMonth: Array.from(monthMap.entries()).map(([month, count]) => ({ month, count })),
  };
}

/**
 * LoyaltyPartnerDashboard — главный экспорт компонента.
 */
export function LoyaltyPartnerDashboard(): React.JSX.Element {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [activeTab, setActiveTab] = React.useState("overview");
  const [createOpen, setCreateOpen] = React.useState(false);

  const partnerQ = usePartnerProfile();
  const actionsQ = useCrossActions();
  const exchangesQ = usePointExchanges();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => useAppStore.getState().setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const stats = computeStats(actionsQ.data || [], exchangesQ.data || []);
  const partner = partnerQ.data;

  const content = (): React.JSX.Element => {
    if (partnerQ.isLoading || actionsQ.isLoading || exchangesQ.isLoading) {
      return <LoadingState message="Загружаем данные партнёра..." />;
    }
    if (partnerQ.error || actionsQ.error || exchangesQ.error) {
      return (
        <ErrorState
          error={new Error(
            partnerQ.error?.message || actionsQ.error?.message || exchangesQ.error?.message || "Unknown"
          )}
          onRetry={() => {
            partnerQ.refetch();
            actionsQ.refetch();
            exchangesQ.refetch();
          }}
        />
      );
    }

    // Если у пользователя нет партнёрского профиля — показать onboarding
    if (!partner) {
      return (
        <EmptyState
          icon={Building2}
          title="Зарегистрируйтесь как партнёр лояльности"
          text="Создайте профиль компании, чтобы запускать кросс-акции и обмениваться бонусами с пользователями платформы"
          action="Создать профиль"
          onAction={() => toast.info("Форма регистрации скоро будет доступна")}
        />
      );
    }

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-3">Обзор — {partner.company_name}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={Gift}
                  label="Активных акций"
                  value={stats.activeActions}
                  color="text-amber-600"
                />
                <StatCard
                  icon={Activity}
                  label="Использований всего"
                  value={stats.totalUsages}
                  color="text-blue-600"
                />
                <StatCard
                  icon={RefreshCw}
                  label="Обменов бонусами"
                  value={stats.totalExchanges}
                  color="text-emerald-600"
                />
                <StatCard
                  icon={TrendingUp}
                  label="Получено бонусов"
                  value={stats.pointsExchanged.toLocaleString("ru-RU")}
                  color="text-purple-600"
                />
              </div>
            </div>

            {/* Статус верификации */}
            <Card className="p-4">
              <div className="flex items-center gap-3">
                {partner.is_verified ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                ) : (
                  <Clock className="w-8 h-8 text-amber-500" />
                )}
                <div className="flex-1">
                  <div className="font-semibold">
                    {partner.is_verified ? "Профиль верифицирован" : "Ожидает верификации"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {partner.is_verified
                      ? "Вы можете создавать кросс-акции и обмениваться бонусами"
                      : "Администратор проверяет ваш профиль. Это займёт 1-2 рабочих дня."}
                  </div>
                </div>
                <Badge variant={partner.is_verified ? "default" : "secondary"}>
                  {partner.is_verified ? "✓ Верифицирован" : "На модерации"}
                </Badge>
              </div>
            </Card>

            {/* График обменов */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Обмены бонусами за 12 месяцев</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={stats.usageByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                    <Bar dataKey="count" name="Обменов" fill="#8e7423" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Распределение по типам акций */}
            {stats.actionsByType.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold mb-3">Распределение акций по типам</h3>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats.actionsByType}
                        dataKey="count"
                        nameKey="type"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={(entry: any) => `${entry.type}: ${entry.count}`}
                      >
                        {stats.actionsByType.map((_, i) => (
                          <Cell
                            key={i}
                            fill={["#8e7423", "#5d3ac7", "#418f5b", "#9f7e3d"][i % 4]}
                          />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </div>
        );

      case "profile":
        return (
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Профиль компании</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Название компании</Label>
                <Input defaultValue={partner.company_name} />
              </div>
              <div>
                <Label>Тип компании</Label>
                <Select defaultValue={partner.company_type}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>ИНН</Label>
                <Input defaultValue={partner.inn || ""} />
              </div>
              <div>
                <Label>Email для связи</Label>
                <Input defaultValue={partner.contact_email} />
              </div>
              <div>
                <Label>Телефон</Label>
                <Input defaultValue={partner.contact_phone || ""} />
              </div>
              <div className="md:col-span-2">
                <Label>Юридический адрес</Label>
                <Textarea defaultValue={partner.legal_address || ""} rows={2} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button>Сохранить изменения</Button>
              <Badge variant={partner.is_verified ? "default" : "secondary"}>
                {partner.is_verified ? "Верифицирован" : "На модерации"}
              </Badge>
            </div>
          </Card>
        );

      case "actions":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                Кросс-акции ({actionsQ.data?.length || 0})
              </h2>
              <Button
                onClick={() => setCreateOpen(true)}
                disabled={!partner.is_verified}
              >
                <Plus className="w-4 h-4 mr-2" />
                Новая акция
              </Button>
            </div>

            {!partner.is_verified && (
              <Card className="p-4 bg-amber-50 border-amber-200">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600" />
                  <span className="text-sm">
                    Создание акций доступно только верифицированным партнёрам. Ожидайте проверки администратора.
                  </span>
                </div>
              </Card>
            )}

            {(actionsQ.data || []).length === 0 ? (
              <EmptyState
                icon={Gift}
                title="У вас ещё нет кросс-акций"
                text="Создайте первую акцию — скидку, бонус или подарок для пользователей платформы"
                action={partner.is_verified ? "Создать акцию" : undefined}
                onAction={partner.is_verified ? () => setCreateOpen(true) : undefined}
              />
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {(actionsQ.data || []).map((a) => (
                  <ActionCard key={a.id} action={a} />
                ))}
              </div>
            )}
          </div>
        );

      case "exchanges":
        return (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">
              Обмены бонусами ({exchangesQ.data?.length || 0})
            </h2>
            {(exchangesQ.data || []).length === 0 ? (
              <EmptyState
                icon={RefreshCw}
                title="Обменов пока нет"
                text="Когда пользователи начнут обмениваться бонусами с вашей системой, они появятся здесь"
              />
            ) : (
              <Card className="p-4">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2">Дата</th>
                      <th className="py-2">Направление</th>
                      <th className="py-2 text-right">Бонусов</th>
                      <th className="py-2 text-center">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(exchangesQ.data || []).map((e) => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="py-2">{formatDateTime(e.created_at)}</td>
                        <td className="py-2">
                          {e.direction === "from_partner" ? "↓ В платформу" : "↑ Из платформы"}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {e.points_amount.toLocaleString("ru-RU")}
                        </td>
                        <td className="py-2 text-center">
                          <Badge
                            variant={
                              e.status === "completed" ? "default"
                                : e.status === "pending" ? "secondary"
                                : e.status === "failed" ? "destructive"
                                : "outline"
                            }
                          >
                            {e.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        );

      case "settings":
        return (
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Настройки интеграции</h2>
            <div className="space-y-4">
              <div>
                <Label>API ключ</Label>
                <Input
                  type="password"
                  defaultValue="••••••••••••••••"
                  disabled
                />
                <p className="text-xs text-muted-foreground mt-1">
                  API ключ генерируется отдельно. Не передавайте его третьим лицам.
                </p>
              </div>
              <div>
                <Label>Разрешённые scopes</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="secondary">read:cross_actions</Badge>
                  <Badge variant="secondary">write:point_exchanges</Badge>
                  <Badge variant="secondary">read:balance</Badge>
                </div>
              </div>
              <Button variant="outline">Сгенерировать новый API ключ</Button>
            </div>
          </Card>
        );

      default:
        return <div>Неизвестный раздел</div>;
    }
  };

  return (
    <>
      <DashboardShell
        user={user}
        logout={logout}
        title="Партнёр лояльности"
        role="LOYALTY_PARTNER"
        icon={Gift}
        gradient="from-purple-500 to-pink-600"
        tabs={TABS}
        activeTab={activeTab}
        onTab={setActiveTab}
      >
        {content()}
      </DashboardShell>

      <CreateActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        partnerId={partner?.id || ""}
      />
    </>
  );
}

/**
 * Карточка кросс-акции.
 */
function ActionCard({ action }: { action: LoyaltyCrossAction }): React.JSX.Element {
  const discountTypeLabel =
    DISCOUNT_TYPES.find((t) => t.value === action.discount_type)?.label || action.discount_type;

  const progress = action.usage_limit
    ? Math.min(100, (action.usage_count / action.usage_limit) * 100)
    : 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <h3 className="font-semibold text-sm">{action.title}</h3>
          <Badge variant="outline" className="mt-1">
            {discountTypeLabel}: {action.discount_value}
            {action.discount_type === "percent" ? "%" : ""}
          </Badge>
        </div>
        {action.is_active ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500" />
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{action.description}</p>

      <div className="text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Период:</span>
          <span>
            {formatDate(action.start_at)} — {formatDate(action.end_at)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Использований:</span>
          <span>
            {action.usage_count} {action.usage_limit ? `из ${action.usage_limit}` : ""}
          </span>
        </div>
        {action.usage_limit && (
          <div className="w-full bg-muted rounded h-1.5 mt-2">
            <div
              className="bg-emerald-500 h-1.5 rounded transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Диалог создания новой кросс-акции.
 */
function CreateActionDialog({
  open,
  onOpenChange,
  partnerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  partnerId: string;
}): React.JSX.Element {
  const createAction = useCreateAction();
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    discount_type: "percent" as LoyaltyCrossAction["discount_type"],
    discount_value: 10,
    start_at: new Date().toISOString().slice(0, 16),
    end_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    usage_limit: null as number | null,
  });

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Заполните название и описание");
      return;
    }
    if (!partnerId) {
      toast.error("Не удалось определить partner_id");
      return;
    }
    try {
      await createAction.mutateAsync({
        partner_id: partnerId,
        title: form.title,
        description: form.description,
        discount_type: form.discount_type,
        discount_value: form.discount_value,
        start_at: new Date(form.start_at).toISOString(),
        end_at: new Date(form.end_at).toISOString(),
        usage_limit: form.usage_limit,
      });
      onOpenChange(false);
    } catch {
      // error handled in mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Новая кросс-акция</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="action-title">Название *</Label>
            <Input
              id="action-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="10% кешбэк бонусами при оплате"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="action-desc">Описание *</Label>
            <Textarea
              id="action-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Подробное описание акции для пользователей..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Тип скидки</Label>
              <Select
                value={form.discount_type}
                onValueChange={(v) =>
                  setForm({ ...form, discount_type: v as LoyaltyCrossAction["discount_type"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="discount-value">Значение</Label>
              <Input
                id="discount-value"
                type="number"
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {form.discount_type === "percent" ? "0-100 (%)" : "Сумма в бонусах/₽"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start-at">Начало</Label>
              <Input
                id="start-at"
                type="datetime-local"
                value={form.start_at}
                onChange={(e) => setForm({ ...form, start_at: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="end-at">Окончание</Label>
              <Input
                id="end-at"
                type="datetime-local"
                value={form.end_at}
                onChange={(e) => setForm({ ...form, end_at: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="usage-limit">Лимит использований (опционально)</Label>
            <Input
              id="usage-limit"
              type="number"
              value={form.usage_limit ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  usage_limit: e.target.value ? Number(e.target.value) : null,
                })
              }
              placeholder="Без лимита"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={createAction.isPending}>
            {createAction.isPending ? "Создание..." : "Создать акцию"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
