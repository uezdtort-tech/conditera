"use client";

/**
 * ZeroResult — опыт при пустом результате поиска (раздел 64).
 *
 * НЕ показывать "Ничего не найдено".
 * Показать:
 *   - похожие варианты
 *   - соседние города
 *   - альтернативный бюджет
 *   - AI-assisted refinement
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Lightbulb, MapPin, TrendingDown, Sparkles } from "lucide-react";

interface ZeroResultProps {
  query?: string;
  onRefine?: () => void;
  suggestions?: Array<{ label: string; onClick: () => void }>;
}

export function ZeroResult({ query, onRefine, suggestions = [] }: ZeroResultProps): React.JSX.Element {
  return (
    <Card className="p-8 text-center space-y-4 border-dashed">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
        <Search className="h-8 w-8 text-muted-foreground" />
      </div>

      <div>
        <h3 className="font-display text-lg font-bold mb-1">
          По запросу «{query || "..."}» ничего не нашлось
        </h3>
        <p className="text-sm text-muted-foreground">
          Попробуйте изменить параметры поиска — мы нашли альтернативы:
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
        {suggestions.map((s, i) => (
          <Button key={i} variant="outline" size="sm" onClick={s.onClick}>
            {s.label}
          </Button>
        ))}

        {suggestions.length === 0 && (
          <>
            <Button variant="outline" size="sm">
              <TrendingDown className="h-4 w-4 mr-1" />
              Увеличить бюджет
            </Button>
            <Button variant="outline" size="sm">
              <MapPin className="h-4 w-4 mr-1" />
              Соседние города
            </Button>
            <Button variant="outline" size="sm">
              <Lightbulb className="h-4 w-4 mr-1" />
              Похожие товары
            </Button>
            <Button variant="outline" size="sm" onClick={onRefine}>
              <Sparkles className="h-4 w-4 mr-1" />
              AI уточнение
            </Button>
          </>
        )}
      </div>

      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          Или опишите словами что вы хотите —{" "}
          <button onClick={onRefine} className="text-primary hover:underline">
            AI поможет найти →
          </button>
        </p>
      </div>
    </Card>
  );
}
