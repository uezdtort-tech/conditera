"use client";

/**
 * IntentChips — чипы намерений (раздел 62).
 *
 * Показывают извлечённые параметры из поискового запроса.
 * Пользователь может редактировать/убирать параметры.
 */

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { X, Cake, Users, MapPin, Calendar, Coins, Leaf, Sparkles } from "lucide-react";

interface IntentChip {
  key: string;
  label: string;
  value: string;
  icon: typeof Cake;
}

interface IntentChipsProps {
  intent: Record<string, unknown>;
  onRemove?: (key: string) => void;
  className?: string;
}

const ICON_MAP: Record<string, typeof Cake> = {
  occasion: Cake,
  servings: Users,
  budget: Coins,
  city: MapPin,
  date: Calendar,
  dietary: Leaf,
  taste: Sparkles,
  style: Sparkles,
};

const LABEL_MAP: Record<string, string> = {
  occasion: "Событие",
  servings: "Порций",
  budget: "Бюджет",
  city: "Город",
  date: "Дата",
  dietary: "Диета",
  taste: "Вкус",
  style: "Стиль",
};

export function IntentChips({ intent, onRemove, className }: IntentChipsProps): React.JSX.Element {
  const chips: IntentChip[] = Object.entries(intent).map(([key, value]) => ({
    key,
    label: LABEL_MAP[key] || key,
    value: Array.isArray(value) ? value.join(", ") : String(value),
    icon: ICON_MAP[key] || Sparkles,
  }));

  if (chips.length === 0) return <></>;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className || ""}`}>
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <Badge
            key={chip.key}
            variant="secondary"
            className="text-xs gap-1.5 py-1 px-2"
          >
            <Icon className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium">{chip.label}:</span>
            <span>{chip.value}</span>
            {onRemove && (
              <button
                onClick={() => onRemove(chip.key)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
