"use client";

/**
 * Customer Loyalty Tab + Notification Preferences Tab.
 *
 * Loyalty: shows points balance, level progress, transaction history, perks,
 *          ability to redeem points for the next order.
 * Notifications: per-channel (email/sms/push/telegram/in-app) + per-category
 *                opt-ins, quiet hours, frequency cap.
 */
import { useAppStore } from "@/lib/store";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Award,
  Coins,
  TrendingUp,
  Gift,
  Calendar,
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Send,
  Moon,
  Clock,
  Check,
  Sparkles,
  Crown,
  ShoppingBag,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
} from "lucide-react";
import {
  LOYALTY,
  formatCurrency,
  formatDate,
} from "@/lib/finance";
import { LEVELS, type LoyaltyLevel, formatPoints } from "@/lib/loyalty-config";
import { toast } from "sonner";

// ====== LOYALTY TAB ======

export function CustomerLoyaltyTab() {
  const user = useAppStore((s) => s.user);
  const orders = useAppStore((s) => s.orders);

  const totalSpent = orders
    .filter(
      (o) =>
        o.customerId === user?.id &&
        (o.paymentStatus === "released" || o.paymentStatus === "escrow")
    )
    .reduce((sum, o) => sum + o.total, 0);

  const loyaltyLevel = (user?.loyaltyLevel || "BRONZE") as LoyaltyLevel;
  const nextLevel: LoyaltyLevel | null =
    loyaltyLevel === "BRONZE"
      ? "SILVER"
      : loyaltyLevel === "SILVER"
      ? "GOLD"
      : loyaltyLevel === "GOLD"
      ? "PLATINUM"
      : null;

  const nextLevelThreshold = nextLevel ? LEVELS[nextLevel].minSpent : 0;
  const progressToNext = nextLevel
    ? Math.min(100, (totalSpent / nextLevelThreshold) * 100)
    : 100;
  const remainingToNext = nextLevel
    ? Math.max(0, nextLevelThreshold - totalSpent)
    : 0;

  // Mock transaction history (would come from API)
  const mockTransactions = [
    {
      id: "tx1",
      type: "EARN",
      points: 24,
      description: "Начисление за заказ #UK-2026-00124",
      createdAt: "2026-07-10T14:30:00Z",
      balanceAfter: 1240,
    },
    {
      id: "tx2",
      type: "BONUS_BIRTHDAY",
      points: 1000,
      description: "Подарок ко дню рождения",
      createdAt: "2026-06-15T09:00:00Z",
      balanceAfter: 1216,
    },
    {
      id: "tx3",
      type: "EARN",
      points: 18,
      description: "Начисление за заказ #UK-2026-00098",
      createdAt: "2026-06-01T11:20:00Z",
      balanceAfter: 216,
    },
    {
      id: "tx4",
      type: "BONUS_WELCOME",
      points: 100,
      description: "Приветственный бонус",
      createdAt: "2026-05-01T10:00:00Z",
      balanceAfter: 100,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header card with balance + level */}
      <Card className="overflow-hidden">
        <div
          className="p-6 text-white"
          style={{
            background: `linear-gradient(135deg, ${LEVELS[loyaltyLevel].color}, ${LEVELS[loyaltyLevel].color}dd)`,
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-sm opacity-90 mb-1">Ваш уровень</div>
              <div className="flex items-center gap-2">
                <Crown className="h-7 w-7" />
                <span className="font-display text-3xl font-bold">
                  {LEVELS[loyaltyLevel].name}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm opacity-90 mb-1">Бонусов</div>
              <div className="flex items-center gap-2">
                <Coins className="h-6 w-6" />
                <span className="font-display text-3xl font-bold">
                  {user?.bonusBalance || 0}
                </span>
              </div>
            </div>
          </div>

          {nextLevel ? (
            <>
              <div className="text-sm opacity-90 mb-2">
                До уровня «{LEVELS[nextLevel].name}»:{" "}
                <strong>{formatCurrency(remainingToNext)}</strong>
              </div>
              <Progress
                value={progressToNext}
                className="h-2 bg-white/20"
              />
              <div className="flex justify-between text-xs mt-1 opacity-75">
                <span>{formatCurrency(totalSpent)} потрачено</span>
                <span>{formatCurrency(nextLevelThreshold)} до следующего уровня</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm bg-white/20 rounded-lg px-3 py-2">
              <Sparkles className="h-4 w-4" />
              Достигнут максимальный уровень! Поздравляем 🎉
            </div>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={ShoppingBag}
          label="Потрачено"
          value={formatCurrency(totalSpent)}
          color="text-emerald-600 bg-emerald-100"
        />
        <StatCard
          icon={Coins}
          label="Бонусов"
          value={formatPoints(user?.bonusBalance || 0)}
          color="text-amber-600 bg-amber-100"
        />
        <StatCard
          icon={TrendingUp}
          label="Множитель"
          value={`×${LEVELS[loyaltyLevel].multiplier}`}
          color="text-purple-600 bg-purple-100"
        />
        <StatCard
          icon={Gift}
          label="Кэшбек"
          value={`${LEVELS[loyaltyLevel].discount}%`}
          color="text-pink-600 bg-pink-100"
        />
      </div>

      {/* Levels grid */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Уровни лояльности
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.entries(LEVELS) as [LoyaltyLevel, typeof LEVELS["BRONZE"]][]).map(
            ([key, lvl]) => {
              const isCurrent = key === loyaltyLevel;
              const isAchieved = totalSpent >= lvl.minSpent;
              return (
                <div
                  key={key}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    isCurrent
                      ? "border-primary shadow-md"
                      : isAchieved
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-muted"
                  }`}
                  style={
                    isCurrent
                      ? { borderColor: lvl.color }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ background: lvl.color }}
                    />
                    <span className="font-medium" style={{ color: lvl.color }}>
                      {lvl.name}
                    </span>
                    {isCurrent && (
                      <Badge className="ml-auto text-xs bg-primary text-white">
                        Вы
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    От {formatCurrency(lvl.minSpent)}
                  </div>
                  <ul className="text-xs space-y-1">
                    {lvl.perks.slice(0, 3).map((perk, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <Check className="h-3 w-3 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span>{perk}</span>
                      </li>
                    ))}
                    {lvl.perks.length > 3 && (
                      <li className="text-muted-foreground">
                        + ещё {lvl.perks.length - 3}
                      </li>
                    )}
                  </ul>
                </div>
              );
            }
          )}
        </div>
      </Card>

      {/* Transaction history */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          История начислений
        </h3>
        <div className="space-y-2">
          {mockTransactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  tx.points > 0
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-red-100 text-red-600"
                }`}
              >
                {tx.points > 0 ? (
                  <ArrowDownLeft className="h-5 w-5" />
                ) : (
                  <ArrowUpRight className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">
                  {tx.description}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(tx.createdAt)} · баланс: {tx.balanceAfter}
                </div>
              </div>
              <div
                className={`font-bold text-sm ${
                  tx.points > 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {tx.points > 0 ? "+" : ""}
                {tx.points}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm">
            Показать ещё
          </Button>
        </div>
      </Card>

      {/* How to earn */}
      <Card className="p-4 bg-gradient-to-br from-amber-50 to-pink-50 dark:from-amber-950/30 dark:to-pink-950/30">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-600" />
          Как заработать бонусы
        </h3>
        <ul className="text-sm space-y-1.5 text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <span>
              <strong>1 балл за каждые 100 ₽</strong> в каждом заказе (с множителем уровня)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Кэшбек {LEVELS[loyaltyLevel].discount}%</strong> баллами с каждого заказа
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <span>
              <strong>+100 бонусов</strong> за отзыв с фото (максимум 5 отзывов в месяц)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <span>
              <strong>+500 бонусов</strong> за приглашённого друга, который сделает первый заказ
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Подарок в день рождения</strong> (от 300 до 2500 бонусов в зависимости от уровня)
            </span>
          </li>
        </ul>
        <Separator className="my-3" />
        <div className="text-xs text-muted-foreground">
          <Info className="h-3 w-3 inline mr-1" />
          Бонусы сгорают через 12 месяцев без активности. Используйте их при следующем заказе!
        </div>
      </Card>
    </div>
  );
}

// ====== NOTIFICATIONS PREFERENCES TAB ======

interface NotifyPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  telegramEnabled: boolean;
  inAppEnabled: boolean;
  orderUpdates: boolean;
  paymentUpdates: boolean;
  promos: boolean;
  messages: boolean;
  reviews: boolean;
  loyalty: boolean;
  abandonedCart: boolean;
  digest: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  maxPerDay: number;
}

const DEFAULT_PREFS: NotifyPrefs = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: true,
  telegramEnabled: false,
  inAppEnabled: true,
  orderUpdates: true,
  paymentUpdates: true,
  promos: true,
  messages: true,
  reviews: true,
  loyalty: true,
  abandonedCart: true,
  digest: true,
  quietHoursStart: 22,
  quietHoursEnd: 9,
  timezone: "Europe/Moscow",
  maxPerDay: 20,
};

export function CustomerNotificationsTab() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);

  // In real app: load from /api/notifications/preferences on mount
  useEffect(() => {
    // skip API call in mock mode
  }, []);

  const update = <K extends keyof NotifyPrefs>(key: K, value: NotifyPrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    // In real app: PUT /api/notifications/preferences
  };

  const save = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success("Настройки уведомлений сохранены");
    }, 600);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Каналы связи
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Выберите, через какие каналы вы хотите получать уведомления
        </p>

        <div className="space-y-3">
          <ChannelRow
            icon={Mail}
            label="Email"
            description="На адрес вашей почты"
            checked={prefs.emailEnabled}
            onChange={(v) => update("emailEnabled", v)}
          />
          <ChannelRow
            icon={MessageSquare}
            label="SMS"
            description="На номер телефона (платная опция)"
            checked={prefs.smsEnabled}
            onChange={(v) => update("smsEnabled", v)}
          />
          <ChannelRow
            icon={Bell}
            label="Push-уведомления"
            description="В браузере или мобильном приложении"
            checked={prefs.pushEnabled}
            onChange={(v) => update("pushEnabled", v)}
          />
          <ChannelRow
            icon={Send}
            label="Telegram"
            description="Через бота @conditera_bot"
            checked={prefs.telegramEnabled}
            onChange={(v) => update("telegramEnabled", v)}
          />
          <ChannelRow
            icon={Smartphone}
            label="В приложении"
            description="В разделе «Колокольчик» сверху"
            checked={prefs.inAppEnabled}
            onChange={(v) => update("inAppEnabled", v)}
          />
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Категории уведомлений
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Отключите то, что вам не интересно
        </p>

        <div className="space-y-3">
          <CategoryRow
            label="Статусы заказов"
            description="Создан, подтверждён, готов, доставлен"
            checked={prefs.orderUpdates}
            onChange={(v) => update("orderUpdates", v)}
          />
          <CategoryRow
            label="Платежи"
            description="Оплата прошла, возврат, ошибка карты"
            checked={prefs.paymentUpdates}
            onChange={(v) => update("paymentUpdates", v)}
          />
          <CategoryRow
            label="Сообщения"
            description="Новые сообщения от кондитеров и поддержки"
            checked={prefs.messages}
            onChange={(v) => update("messages", v)}
          />
          <CategoryRow
            label="Отзывы"
            description="Новые отзывы на ваши товары, ответы кондитеров"
            checked={prefs.reviews}
            onChange={(v) => update("reviews", v)}
          />
          <CategoryRow
            label="Бонусы и лояльность"
            description="Начисления, сгорание, новые уровни"
            checked={prefs.loyalty}
            onChange={(v) => update("loyalty", v)}
          />
          <CategoryRow
            label="Акции и промокоды"
            description="Скидки от любимых кондитеров, спецпредложения"
            checked={prefs.promos}
            onChange={(v) => update("promos", v)}
          />
          <CategoryRow
            label="Брошенная корзина"
            description="Напоминание о товарах, которые вы забыли оформить"
            checked={prefs.abandonedCart}
            onChange={(v) => update("abandonedCart", v)}
          />
          <CategoryRow
            label="Дайджест недели"
            description="Сводка новинок и акций раз в неделю"
            checked={prefs.digest}
            onChange={(v) => update("digest", v)}
          />
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Moon className="h-5 w-5 text-primary" />
          Тихие часы
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          В это время уведомления будут накапливаться, а не приходить сразу
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">С</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min={0}
                max={23}
                value={prefs.quietHoursStart}
                onChange={(e) =>
                  update("quietHoursStart", parseInt(e.target.value) || 0)
                }
              />
              <span className="text-sm">:00</span>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">До</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min={0}
                max={23}
                value={prefs.quietHoursEnd}
                onChange={(e) =>
                  update("quietHoursEnd", parseInt(e.target.value) || 0)
                }
              />
              <span className="text-sm">:00</span>
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        <div>
          <Label className="text-xs text-muted-foreground">
            Максимум уведомлений в день
          </Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={prefs.maxPerDay}
            onChange={(e) =>
              update("maxPerDay", parseInt(e.target.value) || 1)
            }
            className="mt-1 max-w-[120px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Важные уведомления (платежи, заказы) приходят всегда
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={loading}>
          {loading ? "Сохранение..." : "Сохранить настройки"}
        </Button>
      </div>
    </div>
  );
}

// ====== Shared small components ======

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card className="p-3">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${color}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="font-semibold">{value}</div>
    </Card>
  );
}

function ChannelRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium text-sm">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function CategoryRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex-1">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
