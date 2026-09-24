"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CreditCard,
  Plus,
  Trash2,
  Check,
  Calendar,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import {
  INSTALLMENT_PROVIDERS,
  PAYMENT_METHOD_INFO,
  formatCurrency,
} from "@/lib/finance";
import type { InstallmentPlan } from "@/lib/types";
import { toast } from "sonner";

export function ConfectionerPaymentTab({
  confectionerId,
}: {
  confectionerId: string;
}) {
  const confectioners = useAppStore((s) => s.confectioners);
  const confectioner = confectioners.find((c) => c.id === confectionerId);
  const [showAddPlan, setShowAddPlan] = useState(false);

  if (!confectioner?.paymentSettings) {
    return (
      <Card className="p-8 text-center">
        <CreditCard className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <h3 className="font-semibold mb-1">Настройки оплаты не найдены</h3>
        <p className="text-sm text-muted-foreground">
          Обратитесь в поддержку для активации платёжного модуля
        </p>
      </Card>
    );
  }

  const settings = confectioner.paymentSettings;
  const plans = settings.installmentPlans.filter((p) => p.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Оплата и рассрочка
          </h1>
          <p className="text-sm text-muted-foreground">
            Настройте способы оплаты и варианты рассрочки для ваших клиентов.
            Эти настройки отображаются в карточках товаров и при оформлении заказа.
          </p>
        </div>
      </div>

      {/* Способы оплаты */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Принимаемые способы оплаты</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { key: "acceptCard", label: "💳 Банковская карта", desc: "Visa, Mastercard, Мир" },
            { key: "acceptSbp", label: "⚡ СБП", desc: "Система быстрых платежей" },
            { key: "acceptCash", label: "💵 Наличные", desc: "При получении" },
            { key: "acceptSplit", label: "🔀 Сплит", desc: "Разделить платёж между людьми" },
          ].map((m) => {
            const enabled = (settings as any)[m.key];
            return (
              <div
                key={m.key}
                className={`p-3 border rounded-lg flex items-center justify-between ${
                  enabled ? "border-emerald-300 bg-emerald-50" : "border-border"
                }`}
              >
                <div>
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="text-xs text-muted-foreground">{m.desc}</div>
                </div>
                <Checkbox checked={enabled} />
              </div>
            );
          })}
        </div>
        <div className="mt-3 p-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-800 flex items-center gap-1.5">
          <Check className="h-3 w-3" />
          Эскроу-счёт (24 часа) — всегда включён для всех заказов
        </div>
      </Card>

      {/* Рассрочка */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-rose-600" />
              Варианты рассрочки
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Минимальная сумма для рассрочки: {formatCurrency(settings.installmentMinAmount)}
            </p>
          </div>
          <Button size="sm" onClick={() => setShowAddPlan(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить вариант
          </Button>
        </div>

        {/* Партнёры */}
        <div className="mb-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Подключённые партнёры:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {settings.installmentProviders.map((p) => {
              const provider = INSTALLMENT_PROVIDERS[p];
              return (
                <Badge key={p} variant="outline" className={provider.color}>
                  {provider.icon} {provider.shortLabel}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Список планов */}
        <div className="space-y-2">
          {plans.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Нет активных вариантов рассрочки
            </div>
          ) : (
            plans.map((plan) => {
              const provider = INSTALLMENT_PROVIDERS[plan.provider];
              return (
                <div
                  key={plan.id}
                  className="p-3 border border-border rounded-lg flex items-start justify-between gap-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{provider?.icon}</span>
                      <div>
                        <div className="font-medium text-sm">{plan.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {provider?.label}
                        </div>
                      </div>
                    </div>
                    {plan.description && (
                      <p className="text-xs text-muted-foreground mb-2">
                        {plan.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {plan.months} мес
                      </Badge>
                      {plan.interestRate === 0 ? (
                        <Badge className="bg-emerald-500 text-white text-[10px]">
                          0% переплата
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          +{plan.interestRate}% переплата
                        </Badge>
                      )}
                      {plan.downPaymentPercent > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          1-й взнос {plan.downPaymentPercent}%
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        от {formatCurrency(plan.minAmount)}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => toast.success("План удалён")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Статистика */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Эффективность рассрочки
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Заказов в рассрочку</div>
            <div className="font-display text-xl font-bold">24</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Сумма</div>
            <div className="font-display text-xl font-bold">
              {formatCurrency(184000)}
            </div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Конверсия</div>
            <div className="font-display text-xl font-bold text-emerald-600">+18%</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Средний чек</div>
            <div className="font-display text-xl font-bold">
              {formatCurrency(7650)}
            </div>
          </div>
        </div>
        <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-1.5">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <div>
            Подключение рассрочки увеличивает конверсию на 15-25% и средний чек на 30-50%.
            Особенно эффективно для заказов от 5000 ₽.
          </div>
        </div>
      </Card>

      {showAddPlan && (
        <AddInstallmentPlanDialog
          onClose={() => setShowAddPlan(false)}
          onAdd={(plan) => {
            toast.success("Вариант рассрочки добавлен!");
            setShowAddPlan(false);
          }}
        />
      )}
    </div>
  );
}

function AddInstallmentPlanDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (plan: Omit<InstallmentPlan, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [months, setMonths] = useState(3);
  const [interestRate, setInterestRate] = useState(0);
  const [minAmount, setMinAmount] = useState(3000);
  const [downPaymentPercent, setDownPaymentPercent] = useState(0);
  const [provider, setProvider] = useState<InstallmentPlan["provider"]>("split");
  const [description, setDescription] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить вариант рассрочки</DialogTitle>
          <DialogDescription>
            Настройте условия рассрочки для покупателей. Этот вариант будет
            отображаться в карточках ваших товаров.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Рассрочка на 3 месяца"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Срок (месяцев)</Label>
              <Input
                type="number"
                value={months}
                onChange={(e) => setMonths(+e.target.value)}
                min={1}
                max={24}
              />
            </div>
            <div>
              <Label>Процент переплаты</Label>
              <Input
                type="number"
                value={interestRate}
                onChange={(e) => setInterestRate(+e.target.value)}
                min={0}
                max={50}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">0% = беспроцентная</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Мин. сумма заказа, ₽</Label>
              <Input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(+e.target.value)}
              />
            </div>
            <div>
              <Label>Первый взнос, %</Label>
              <Input
                type="number"
                value={downPaymentPercent}
                onChange={(e) => setDownPaymentPercent(+e.target.value)}
                min={0}
                max={80}
              />
            </div>
          </div>
          <div>
            <Label>Партнёр</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as InstallmentPlan["provider"])}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INSTALLMENT_PROVIDERS).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.icon} {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Описание для покупателей</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Беспроцентная рассрочка на 3 месяца через Сплит"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={!name}
            onClick={() =>
              onAdd({
                name,
                months,
                interestRate,
                minAmount,
                downPaymentPercent,
                provider,
                description,
                isActive: true,
              })
            }
          >
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
