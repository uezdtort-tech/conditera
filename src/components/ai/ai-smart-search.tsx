"use client";

/**
 * AiSmartSearch — умный поиск десертов (сценарий №1 из AI-макета).
 *
 * Покупатель пишет задачу, а не название: «Нужен торт на день рождения
 * ребёнка, без орехов, на 10 человек, к субботе».
 *
 * variant="hero"    — главная: большой инпут + примеры-чипы + inline-результаты
 *                     + переход в каталог с применёнными фильтрами.
 * variant="compact" — каталог: «Уточнить поиск», применяет фильтры через
 *                     onApplyFilters (обычная каталоговая логика).
 *
 * Правила дизайна:
 *   • ИИ не подменяет данные продавца — под результатом дисклеймер;
 *     дата готовности и наличие подтверждаются мастером.
 *   • Обычный путь не спрятан: есть ссылка на обычный поиск в каталог.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/marketplace/product-card";
import { useAppStore } from "@/lib/store";
import { getCsrfToken } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Sparkles,
  Search,
  Loader2,
  ArrowRight,
  Info,
  MessageCircleQuestion,
} from "lucide-react";
import {
  type AiSearchFilters,
  filterProductsByAiFilters,
  describeAiFilters,
} from "@/lib/ai-search-types";

const EXAMPLE_QUERIES = [
  "На день рождения, без орехов",
  "Торт на свадьбу на 20 человек до 15 000 ₽",
  "Подарок без сахара",
];

interface AiSmartSearchProps {
  variant?: "hero" | "compact";
  /** Режим каталога: применить фильтры к локальному состоянию страницы */
  onApplyFilters?: (filters: AiSearchFilters) => void;
}

export function AiSmartSearch({ variant = "hero", onApplyFilters }: AiSmartSearchProps) {
  const navigate = useAppStore((s) => s.navigate);
  const products = useAppStore((s) => s.products);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<AiSearchFilters | null>(null);
  const [generatedBy, setGeneratedBy] = useState<string>("llm");

  const isHero = variant === "hero";

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) {
      toast.error("Опишите запрос подробнее");
      return;
    }
    setLoading(true);
    try {
      // CSRF double-submit: мутации требуют header x-csrf-token
      const csrf = await getCsrfToken();
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Сервис разбора запроса недоступен");
      }
      const data = (await res.json()) as { filters: AiSearchFilters; generatedBy: string };
      setFilters(data.filters);
      setGeneratedBy(data.generatedBy || "llm");

      if (onApplyFilters) {
        // Режим каталога: применяем к текущей странице
        onApplyFilters(data.filters);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка соединения с ИИ");
    } finally {
      setLoading(false);
    }
  };

  const matchedProducts =
    isHero && filters ? filterProductsByAiFilters(products, filters).slice(0, 6) : [];
  const chips = filters ? describeAiFilters(filters) : [];

  return (
    <div className={isHero ? "w-full" : "space-y-2"}>
      {/* Строка поиска */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className={isHero ? "flex gap-2 max-w-xl mx-auto lg:mx-0" : "flex gap-2"}
        role="search"
        aria-label="Умный поиск десертов"
      >
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isHero
                ? "Опишите, что вы ищете... Например: торт на свадьбу на 20 человек до 12 000 ₽"
                : "Уточнить поиск с ИИ: «без орехов, на 15 человек, до 5000 ₽»"
            }
            aria-label="Опишите, что вы ищете"
            className={
              isHero
                ? "w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400"
                : "w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40"
            }
          />
        </div>
        <Button
          type="submit"
          size={isHero ? "lg" : "default"}
          disabled={loading}
          className={
            isHero
              ? "px-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              : "gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          }
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className={isHero ? "h-4 w-4" : "h-3.5 w-3.5"} />
          )}
          Подобрать
        </Button>
      </form>

      {/* Примеры запросов */}
      {!filters && (
        <div
          className={`flex flex-wrap gap-1.5 text-xs text-muted-foreground ${
            isHero ? "justify-center lg:justify-start mt-2" : ""
          }`}
        >
          <span className="py-1">Попробуйте:</span>
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuery(ex);
                runSearch(ex);
              }}
              className="px-2 py-1 rounded-full border border-border hover:border-purple-400 hover:text-purple-700 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* Режим каталога: краткий отклик */}
      {!isHero && filters && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{filters.reply}</span>
          {describeAiFilters(filters).map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
              {c}
            </Badge>
          ))}
        </div>
      )}

      {/* Режим главной: результат */}
      {isHero && filters && (
        <div className="mt-6 space-y-4 max-w-3xl mx-auto lg:mx-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm text-foreground/90">{filters.reply}</p>
            {generatedBy === "rules" && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                разбор без ИИ
              </Badge>
            )}
            {chips.map((c) => (
              <Badge key={c} variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                {c}
              </Badge>
            ))}
          </div>

          {filters.clarifying.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <MessageCircleQuestion className="h-4 w-4 text-purple-500" />
              <span className="text-muted-foreground">Уточните:</span>
              {filters.clarifying.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setQuery(c);
                    runSearch(c);
                  }}
                  className="px-2.5 py-1 rounded-full border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {matchedProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {matchedProducts.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  navigate("catalog", {
                    ai: JSON.stringify(filters),
                    q: filters.keywords[0] || "",
                  })
                }
                className="gap-2"
              >
                Показать все совпадения в каталоге
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm">
              <p className="font-medium mb-1">Точных совпадений не нашлось</p>
              <p className="text-muted-foreground mb-3">
                Попробуйте ослабить ограничения (бюджет, порции) или откройте каталог —
                мастера могут изготовить десерт под заказ.
              </p>
              <Button variant="outline" onClick={() => navigate("catalog")} className="gap-2">
                Открыть каталог
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Подсказки ИИ не заменяют данные продавца: наличие, дату готовности и состав
            подтверждает мастер или карточка товара.
          </p>
        </div>
      )}

      {/* Скрытая ссылка на обычный поиск — путь без ИИ остаётся доступным */}
      {isHero && (
        <button
          type="button"
          onClick={() => navigate("catalog", query.trim() ? { q: query.trim() } : undefined)}
          className="sr-only"
          aria-label="Обычный поиск в каталоге без ИИ"
        >
          <Search className="h-3 w-3" /> Обычный поиск
        </button>
      )}
    </div>
  );
}
