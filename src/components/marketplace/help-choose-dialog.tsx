"use client";

/**
 * HelpChooseDialog — «Помочь выбрать» (P2 §5-§6, §14).
 *
 * Короткая анкета (6 вопросов с возможностью пропустить, не длинная форма):
 *   повод → на сколько человек → бюджет → вкусы → ограничения → когда нужен.
 *
 * Ответы детерминированно превращаются в интент единого поискового движка
 * (answersToIntent) — AI не участвует, данные товара — единственная истина.
 *
 * Результат: «Подобрали для вас N вариантов» (максимум 6 карточек) с
 * фактическим объяснением «Почему мы это предложили» (describeHelpReasons —
 * без маркетингового AI-текста) и честной доступностью к дате (§14): товар,
 * который не успевает к дате, показывается с «Ближайшая дата — …» и ниже
 * в выдаче, а не ошибкой.
 *
 * Работает без регистрации (ТЗ §16): использует текущие товары каталога.
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/marketplace/product-card";
import { useAppStore } from "@/lib/store";
import type { Product } from "@/lib/types";
import {
  ALLERGEN_GROUPS,
  OCCASIONS,
  answersToIntent,
  describeHelpReasons,
  filterAndRank,
  formatReadyDate,
  hasHelpSignals,
  readyByDate,
  toSearchDoc,
  type AllergenKey,
  type HelpChooseAnswers,
  type OccasionKey,
} from "@/lib/product-search";
import { Sparkles, ArrowRight, RotateCcw, Clock } from "lucide-react";

const MAX_RESULTS = 6;

/** Русская плюрализация: вариант/варианта/вариантов. */
function pluralVariants(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "вариант";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "варианта";
  return "вариантов";
}

interface HelpChooseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Каталог: применить ответы к фильтрам; главная: перейти в каталог с ответами */
  onShowInCatalog: (answers: HelpChooseAnswers) => void;
}

const STEP_OCCASION = 0;
const STEP_SERVINGS = 1;
const STEP_BUDGET = 2;
const STEP_TASTE = 3;
const STEP_RESTRICT = 4;
const STEP_WHEN = 5;
const STEP_RESULTS = 6;

const STEP_TITLES = [
  "Какой повод?",
  "На сколько человек?",
  "Какой бюджет?",
  "Предпочтения по вкусу?",
  "Есть ли ограничения?",
  "Когда нужен заказ?",
];

const TASTE_OPTIONS = ["шоколад", "ягоды", "карамель", "ваниль", "фрукты", "орехи"];

export function HelpChooseDialog({ open, onOpenChange, onShowInCatalog }: HelpChooseDialogProps) {
  const products = useAppStore((s) => s.products);
  const [step, setStep] = useState(STEP_OCCASION);
  const [answers, setAnswers] = useState<HelpChooseAnswers>(() => ({
    occasion: null,
    servingsMin: null,
    priceMax: null,
    tastes: [],
    excludeAllergens: [],
    when: null,
  }));
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setAnswers({ occasion: null, servingsMin: null, priceMax: null, tastes: [], excludeAllergens: [], when: null });
    setStep(STEP_OCCASION);
    setSubmitted(false);
  };

  const patch = (p: Partial<HelpChooseAnswers>) => {
    setAnswers((prev) => ({ ...prev, ...p }));
    setStep((s) => Math.min(s + 1, STEP_RESULTS));
  };

  // Подбор: единый движок + ранжирование по доступности к дате (ТЗ §14)
  const results = useMemo(() => {
    if (step !== STEP_RESULTS || !submitted) return [];
    const intent = answersToIntent(answers);
    const ranked = filterAndRank(
      products.map(toSearchDoc),
      intent,
      { sort: hasHelpSignals(answers) ? "popular" : "popular" }
    );
    const withAvailability = ranked.items.map((doc) => {
      const product = products.find((p) => p.id === doc.id) ?? null;
      const availability = readyByDate(
        typeof product?.productionTimeHours === "number" ? product.productionTimeHours : null,
        answers.when
      );
      return { doc, product, availability };
    });
    // доступные к дате — выше; «Ближайшая дата — …» — ниже, но видимы
    withAvailability.sort((a, b) => Number(b.availability.available) - Number(a.availability.available));
    return withAvailability.slice(0, MAX_RESULTS);
  }, [step, submitted, answers, products]);

  const totalCount = useMemo(() => {
    if (step !== STEP_RESULTS || !submitted) return 0;
    const intent = answersToIntent(answers);
    return filterAndRank(products.map(toSearchDoc), intent).total;
  }, [step, submitted, answers, products]);

  const optionButton = (active: boolean) =>
    `justify-start text-left h-auto py-3 px-4 rounded-xl border transition-colors ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "border-border hover:border-primary/40 bg-background"
    }`;

  const renderStep = () => {
    switch (step) {
      case STEP_OCCASION:
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Повод">
            {(Object.keys(OCCASIONS) as OccasionKey[]).map((key) => (
              <Button
                key={key}
                variant="outline"
                className={optionButton(answers.occasion === key)}
                onClick={() => patch({ occasion: key })}
              >
                {OCCASIONS[key].label}
              </Button>
            ))}
          </div>
        );
      case STEP_SERVINGS:
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Количество человек">
            {[2, 6, 10, 15, 20, 30].map((n) => (
              <Button
                key={n}
                variant="outline"
                className={optionButton(answers.servingsMin === n)}
                onClick={() => patch({ servingsMin: n })}
              >
                {n}+ чел.
              </Button>
            ))}
          </div>
        );
      case STEP_BUDGET:
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Бюджет">
            {[1500, 3000, 5000, 10000].map((v) => (
              <Button
                key={v}
                variant="outline"
                className={optionButton(answers.priceMax === v)}
                onClick={() => patch({ priceMax: v })}
              >
                до {v.toLocaleString("ru-RU")} ₽
              </Button>
            ))}
          </div>
        );
      case STEP_TASTE:
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Вкусы">
            {TASTE_OPTIONS.map((t) => (
              <Button
                key={t}
                variant="outline"
                className={optionButton(answers.tastes.includes(t))}
                onClick={() => patch({ tastes: [t] })}
              >
                {t}
              </Button>
            ))}
          </div>
        );
      case STEP_RESTRICT:
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Ограничения">
            {(Object.keys(ALLERGEN_GROUPS) as AllergenKey[]).map((key) => (
              <Button
                key={key}
                variant="outline"
                className={optionButton(answers.excludeAllergens.includes(key))}
                onClick={() => patch({ excludeAllergens: [key] })}
              >
                {ALLERGEN_GROUPS[key].label}
              </Button>
            ))}
          </div>
        );
      case STEP_WHEN:
        return (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Когда нужен заказ">
            {([
              { v: "today", label: "Сегодня" },
              { v: "tomorrow", label: "Завтра" },
              { v: "week", label: "В течение недели" },
              { v: null, label: "Дата гибкая" },
            ] as Array<{ v: HelpChooseAnswers["when"]; label: string }>).map((o) => (
              <Button
                key={o.label}
                variant="outline"
                className={optionButton(answers.when === o.v)}
                onClick={() => {
                  patch({ when: o.v });
                  setSubmitted(true);
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
        );
      case STEP_RESULTS:
        return (
          <div>
            <p className="text-sm font-medium mb-4" aria-live="polite">
              Подобрали для вас {Math.min(results.length, MAX_RESULTS)}{" "}
              {pluralVariants(results.length)}
              {totalCount > results.length && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (всего подходящих: {totalCount})
                </span>
              )}
            </p>
            {results.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-4">
                  Под такие ограничения в каталоге пока нет товаров. Попробуйте
                  расширить бюджет или снять ограничение.
                </p>
                <Button variant="outline" onClick={reset} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  Ответить заново
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[46vh] overflow-y-auto pr-1">
                {results.map(({ doc, product, availability }) =>
                  product ? (
                    <div key={doc.id} className="flex flex-col gap-1.5">
                      <ProductCard product={product} />
                      {/* Почему мы это предложили — только факты (ТЗ §6) */}
                      <p className="text-xs text-muted-foreground px-1">
                        {describeHelpReasons(doc, answers).join(", ")}.
                      </p>
                      {!availability.available && availability.readyAt && (
                        <Badge variant="secondary" className="gap-1 w-fit mx-1">
                          <Clock className="h-3 w-3" />
                          Ближайшая дата — {formatReadyDate(availability.readyAt)}
                        </Badge>
                      )}
                    </div>
                  ) : null
                )}
              </div>
            )}
            {results.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  className="gap-1.5"
                  onClick={() => {
                    onShowInCatalog(answers);
                    onOpenChange(false);
                  }}
                >
                  Показать в каталоге
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={reset} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  Начать заново
                </Button>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const isResults = step === STEP_RESULTS;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl" aria-describedby="help-choose-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Помочь выбрать
          </DialogTitle>
          <DialogDescription id="help-choose-desc">
            {isResults
              ? "Варианты подобраны по вашим ответам на реальных данных каталога"
              : `Ответьте на несколько коротких вопросов — подберём подходящие десерты (вопрос ${step + 1} из 6)`}
          </DialogDescription>
        </DialogHeader>

        {/* Прогресс анкеты */}
        {!isResults && (
          <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: STEP_WHEN + 1 }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        )}

        <div className="mt-1">
          {!isResults && (
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{STEP_TITLES[step]}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === STEP_WHEN) setSubmitted(true);
                  setStep((s) => s + 1);
                }}
              >
                Пропустить
              </Button>
            </div>
          )}
          {renderStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
