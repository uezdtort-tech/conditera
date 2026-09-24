"use client";

/**
 * OrderTimeline — визуальная timeline статусов заказа.
 *
 * Показывает все этапы: PENDING → CONFIRMED → IN_PROGRESS → READY → DELIVERING → COMPLETED
 * Подсвечивает текущий статус, для пройденных — зелёная галочка.
 * Для отменённых — красный X.
 *
 * Используется в customer-дашборде и в чате заказа.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  CheckCircle2,
  Package,
  ChefHat,
  PartyPopper,
  Truck,
  Home,
  XCircle,
  AlertCircle,
} from "lucide-react";

interface OrderTimelineProps {
  status: string;
  createdAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  small?: boolean;
}

const TIMELINE_STEPS = [
  { key: "PENDING", label: "Заказ создан", icon: Clock, color: "text-amber-500" },
  { key: "CONFIRMED", label: "Кондитер принял", icon: CheckCircle2, color: "text-blue-500" },
  { key: "IN_PROGRESS", label: "Готовится", icon: ChefHat, color: "text-purple-500" },
  { key: "READY", label: "Готов", icon: Package, color: "text-cyan-500" },
  { key: "DELIVERING", label: "В пути", icon: Truck, color: "text-orange-500" },
  { key: "COMPLETED", label: "Доставлен", icon: Home, color: "text-emerald-500" },
];

export function OrderTimeline({
  status,
  createdAt,
  deliveredAt,
  cancelledAt,
  small = false,
}: OrderTimelineProps) {
  // CANCELLED и DISPUTE — особые кейсы
  if (status === "CANCELLED") {
    return (
      <Card className={`${small ? "p-3" : "p-4"} border-red-200 bg-red-50/50`}>
        <div className="flex items-center gap-3">
          <XCircle className="h-5 w-5 text-red-500" />
          <div>
            <div className="font-medium text-sm text-red-700">Заказ отменён</div>
            <div className="text-xs text-red-600/70">
              {cancelledAt ? new Date(cancelledAt).toLocaleString("ru-RU") : "Время не указано"}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (status === "DISPUTE") {
    return (
      <Card className={`${small ? "p-3" : "p-4"} border-orange-200 bg-orange-50/50`}>
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-orange-500" />
          <div>
            <div className="font-medium text-sm text-orange-700">Открыт спор</div>
            <div className="text-xs text-orange-600/70">
              Средства на эскроу до решения модератора
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // Находим индекс текущего статуса
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.key === status);
  if (currentIndex === -1) return null;

  return (
    <Card className={small ? "p-3" : "p-4"}>
      <div className="flex items-center justify-between gap-1">
        {TIMELINE_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isPassed = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture = i > currentIndex;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 relative">
                <div
                  className={`
                    ${small ? "h-7 w-7" : "h-9 w-9"}
                    rounded-full flex items-center justify-center
                    ${isPassed ? "bg-emerald-100 text-emerald-600" : ""}
                    ${isCurrent ? `bg-primary/15 ${step.color} ring-2 ring-primary/30` : ""}
                    ${isFuture ? "bg-muted text-muted-foreground" : ""}
                  `}
                >
                  {isPassed ? (
                    <CheckCircle2 className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  ) : (
                    <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  )}
                </div>
                <div
                  className={`
                    text-[9px] sm:text-[10px] text-center font-medium
                    ${isCurrent ? step.color : isPassed ? "text-emerald-600" : "text-muted-foreground"}
                  `}
                >
                  {step.label}
                </div>
                {isCurrent && (
                  <div className="text-[8px] text-primary font-medium">
                    сейчас
                  </div>
                )}
              </div>
              {/* Линия между шагами */}
              {i < TIMELINE_STEPS.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-1 mb-4
                    ${i < currentIndex ? "bg-emerald-300" : "bg-muted"}
                  `}
                />
              )}
            </div>
          );
        })}
      </div>
      {deliveredAt && status === "COMPLETED" && (
        <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-emerald-600">
          <PartyPopper className="h-3.5 w-3.5" />
          Заказ доставлен {new Date(deliveredAt).toLocaleString("ru-RU")}
        </div>
      )}
    </Card>
  );
}
