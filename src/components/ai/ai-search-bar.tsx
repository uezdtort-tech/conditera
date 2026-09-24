"use client";

/**
 * AI Search Bar — поиск с AI intent extraction (раздел 5, 62).
 *
 * Пользователь вводит естественный запрос:
 *   "Хочу торт на свадьбу, 30 человек, до 15000₽, локальный кондитер"
 *
 * AI извлекает intent:
 *   { occasion: "wedding", servings: 30, budget: 15000, preference: "local" }
 *
 * Intent Chips показывают извлечённые параметры.
 */

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Sparkles, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface SearchIntent {
  occasion?: string;
  servings?: number;
  budget?: number;
  city?: string;
  date?: string;
  dietary?: string[];
  taste?: string;
  style?: string;
}

interface AISearchBarProps {
  onSearch?: (query: string, intent: SearchIntent) => void;
  placeholder?: string;
  className?: string;
}

const INTENT_KEYWORDS: Record<string, string[]> = {
  occasion: ["свадьб", "день рождения", "юбилей", "корпоратив", "детский", "романтик", "выпускной", "крестины"],
  dietary: ["без сахара", "без глютена", "веган", "кето", "гипоаллерген", "без лактозы"],
  style: ["современный", "классический", "авторский", "реалистичный", "минимализм", "винтаж"],
  taste: ["шоколад", "ягод", "карамель", "орех", "фрукт", "сливки", "творож"],
};

export function AISearchBar({ onSearch, placeholder, className }: AISearchBarProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [intent, setIntent] = React.useState<SearchIntent>({});
  const [isProcessing, setIsProcessing] = React.useState(false);

  const extractIntent = (text: string): SearchIntent => {
    const result: SearchIntent = {};
    const lower = text.toLowerCase();

    // occasion
    for (const [key, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (key === "occasion" || key === "style" || key === "taste") {
        for (const kw of keywords) {
          if (lower.includes(kw)) {
            (result as Record<string, unknown>)[key] = kw;
            break;
          }
        }
      }
      if (key === "dietary") {
        const found: string[] = [];
        for (const kw of keywords) {
          if (lower.includes(kw)) found.push(kw);
        }
        if (found.length > 0) result.dietary = found;
      }
    }

    // servings (число + "человек/порций/гостей")
    const servingsMatch = lower.match(/(\d+)\s*(человек|порций|гостей|пор)/);
    if (servingsMatch) result.servings = parseInt(servingsMatch[1]);

    // budget (число + "₽/руб" или "до X")
    const budgetMatch = lower.match(/до\s*(\d[\d\s]*)\s*[₽руб]/);
    if (budgetMatch) result.budget = parseInt(budgetMatch[1].replace(/\s/g, ""));

    return result;
  };

  const handleSearch = (): void => {
    if (!query.trim()) return;
    setIsProcessing(true);
    const extracted = extractIntent(query);
    setIntent(extracted);
    setIsProcessing(false);
    onSearch?.(query, extracted);
    toast.success("Поиск запущен", {
      description: Object.keys(extracted).length > 0
        ? `Найдено параметров: ${Object.keys(extracted).length}`
        : "Поиск по тексту",
    });
  };

  const removeIntent = (key: string): void => {
    setIntent((prev) => {
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  };

  return (
    <div className={`w-full ${className || ""}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder || "Опишите что вы хотите... например: торт на свадьбу 30 персон до 15000₽"}
          className="pl-10 pr-24 h-12 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button
          size="sm"
          className="absolute right-2 top-1/2 -translate-y-1/2"
          onClick={handleSearch}
          disabled={isProcessing || !query.trim()}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-1" />
              Найти
            </>
          )}
        </Button>
      </div>

      {Object.keys(intent).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {Object.entries(intent).map(([key, value]) => {
            const display = Array.isArray(value) ? value.join(", ") : String(value);
            return (
              <Badge key={key} variant="secondary" className="text-xs gap-1">
                <span className="font-medium">{key}:</span> {display}
                <button onClick={() => removeIntent(key)} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
