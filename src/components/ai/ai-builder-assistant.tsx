"use client";

/**
 * AIBuilderAssistant — AI помощник в конструкторе тортов (раздел 20, 62).
 *
 * "Помоги выбрать" режим: пользователь описывает потребность,
 * AI предлагает конфигурацию торта (base, filling, coating, decorations).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Wand2, Loader2, Cake, Check } from "lucide-react";
import { toast } from "sonner";

export interface AISuggestion {
  base?: string;
  filling?: string;
  coating?: string;
  decorations?: string[];
  servings?: number;
  estimatedPrice?: number;
  reasoning?: string;
}

interface AIBuilderAssistantProps {
  onApply?: (suggestion: AISuggestion) => void;
}

const OCCASION_SUGGESTIONS: Record<string, AISuggestion> = {
  "свадьб": {
    base: "sponge",
    filling: "chocolate_ganache",
    coating: "mastic",
    decorations: ["sugar_flowers", "edible_gold"],
    servings: 40,
    estimatedPrice: 15000,
    reasoning: "Многоярусный свадебный торт с мастикой, сахарными цветами и сусальным золотом — классика свадебных торжеств.",
  },
  "день рождения": {
    base: "sponge",
    filling: "cream_pleshir",
    coating: "cream_cheese",
    decorations: ["berries", "macarons"],
    servings: 12,
    estimatedPrice: 4500,
    reasoning: "Лёгкий бисквит с кремом пломбир, свежие ягоды и макаронс — празднично и не слишком сладко.",
  },
  "детск": {
    base: "sponge",
    filling: "condensed_milk",
    coating: "mastic",
    decorations: ["sugar_flowers"],
    servings: 10,
    estimatedPrice: 3500,
    reasoning: "Яркий детский торт с мастикой — можно сделать любого героя.",
  },
  "корпорат": {
    base: "cheesecake",
    filling: "chocolate_ganache",
    coating: "mirror_glaze",
    decorations: ["chocolate_curls"],
    servings: 30,
    estimatedPrice: 12000,
    reasoning: "Чизкейк с зеркальной глазурью — современный и элегантный для корпоратива.",
  },
  "летн": {
    base: "mousse",
    filling: "mango_passion",
    coating: "mirror_glaze",
    decorations: ["fresh_fruit", "berries"],
    servings: 8,
    estimatedPrice: 3200,
    reasoning: "Лёгкий муссовый торт с манго-маракуйя и свежими ягодами — идеально для летнего праздника.",
  },
  "романт": {
    base: "red_velvet",
    filling: "cream_pleshir",
    coating: "cream_cheese",
    decorations: ["berries", "meringue"],
    servings: 6,
    estimatedPrice: 2800,
    reasoning: "Красный бархат с кремом и свежими ягодами — романтичный и нежный.",
  },
};

export function AIBuilderAssistant({ onApply }: AIBuilderAssistantProps): React.JSX.Element {
  const [input, setInput] = React.useState("");
  const [suggestion, setSuggestion] = React.useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  const handleSuggest = (): void => {
    if (!input.trim()) {
      toast.error("Опишите что вы хотите");
      return;
    }

    setIsProcessing(true);

    // Simple keyword matching (в v2.0 — через Edge Function с LLM)
    setTimeout(() => {
      const lower = input.toLowerCase();
      let matched: AISuggestion | null = null;

      for (const [keyword, sugg] of Object.entries(OCCASION_SUGGESTIONS)) {
        if (lower.includes(keyword)) {
          matched = sugg;
          break;
        }
      }

      // Default suggestion
      if (!matched) {
        matched = {
          base: "sponge",
          filling: "cream_pleshir",
          coating: "cream_cheese",
          decorations: ["berries"],
          servings: 10,
          estimatedPrice: 3500,
          reasoning: "Классический бисквит с кремом пломбир и свежими ягодами — универсальный выбор для любого случая.",
        };
      }

      setSuggestion(matched);
      setIsProcessing(false);
      toast.success("AI подобрал конфигурацию!");
    }, 800);
  };

  const handleApply = (): void => {
    if (suggestion) {
      onApply?.(suggestion);
      toast.success("Конфигурация применена к конструктору");
    }
  };

  return (
    <Card className="p-4 border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <h4 className="font-medium text-sm">AI помощник</h4>
          <p className="text-[10px] text-muted-foreground">Опишите словами — подберём торт</p>
        </div>
      </div>

      <Textarea
        placeholder="Например: хочу лёгкий торт на летний день рождения дочки, не слишком сладкий, с ягодами"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={2}
        className="text-sm mb-3"
      />

      <Button
        onClick={handleSuggest}
        disabled={isProcessing || !input.trim()}
        className="w-full"
        size="sm"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            Подбираем...
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4 mr-1" />
            Помоги выбрать
          </>
        )}
      </Button>

      {suggestion && (
        <div className="mt-3 space-y-2">
          <div className="bg-card rounded-lg p-3 border">
            <div className="flex items-center gap-1 mb-2">
              <Cake className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Предложение AI</span>
            </div>

            <div className="space-y-1 text-xs">
              {suggestion.base && <div><span className="text-muted-foreground">Основа:</span> {suggestion.base}</div>}
              {suggestion.filling && <div><span className="text-muted-foreground">Начинка:</span> {suggestion.filling}</div>}
              {suggestion.coating && <div><span className="text-muted-foreground">Покрытие:</span> {suggestion.coating}</div>}
              {suggestion.decorations && suggestion.decorations.length > 0 && (
                <div><span className="text-muted-foreground">Декор:</span> {suggestion.decorations.join(", ")}</div>
              )}
              {suggestion.servings && <div><span className="text-muted-foreground">Порций:</span> {suggestion.servings}</div>}
              {suggestion.estimatedPrice && (
                <div className="pt-1 border-t mt-1">
                  <span className="text-muted-foreground">Оценка:</span>{" "}
                  <span className="font-bold text-primary">{suggestion.estimatedPrice} ₽</span>
                </div>
              )}
            </div>

            {suggestion.reasoning && (
              <p className="text-xs text-muted-foreground mt-2 italic">{suggestion.reasoning}</p>
            )}

            <Button onClick={handleApply} size="sm" className="w-full mt-2">
              <Check className="h-4 w-4 mr-1" />
              Применить к конструктору
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
