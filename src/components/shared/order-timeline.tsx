"use client";

/**
 * OrderTimeline — визуализация статуса заказа (раздел 62).
 *
 * Показывает горизонтальный timeline с шагами:
 *   PENDING → CONFIRMED → PREPARING → READY → IN_DELIVERY → DELIVERED → COMPLETED
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag, CheckCircle2, Cake, Package, Truck, Home, PartyPopper,
} from "lucide-react";

const STEPS = [
  { status: "PENDING", label: "Заказ создан", icon: ShoppingBag },
  { status: "CONFIRMED", label: "Подтверждён", icon: CheckCircle2 },
  { status: "PREPARING", label: "Готовится", icon: Cake },
  { status: "READY", label: "Готов", icon: Package },
  { status: "IN_DELIVERY", label: "В пути", icon: Truck },
  { status: "DELIVERED", label: "Доставлен", icon: Home },
  { status: "COMPLETED", label: "Завершён", icon: PartyPopper },
];

interface OrderTimelineProps {
  status: string;
  createdAt?: string;
  confirmedAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  cancelled?: boolean;
}

export function OrderTimeline({
  status,
  cancelled = false,
}: OrderTimelineProps): React.JSX.Element {
  const currentIndex = STEPS.findIndex((s) => s.status === status);

  if (cancelled) {
    return (
      <Card className="p-4 border-destructive/30">
        <div className="flex items-center gap-2 text-destructive">
          <PartyPopper className="h-5 w-5" />
          <span className="font-medium">Заказ отменён</span>
        </div>
      </Card>
    );
  }

  if (status === "REFUNDED") {
    return (
      <Card className="p-4 border-warning/30">
        <Badge variant="outline" className="text-warning">
          Возврат оформлен
        </Badge>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const Icon = step.icon;

          return (
            <React.Fragment key={step.status}>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isDone
                      ? "bg-success text-white"
                      : isCurrent
                      ? "bg-primary text-white ring-4 ring-primary/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={`text-[10px] text-center max-w-[60px] ${
                    isDone || isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {i < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 min-w-4 mx-1 ${
                    i < currentIndex ? "bg-success" : "bg-border"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}
