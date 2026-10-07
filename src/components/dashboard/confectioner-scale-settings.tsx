"use client";

/**
 * confectioner-scale-settings.tsx — выбор масштаба бизнеса (профиль возможностей).
 *
 * P0.5 Core Adaptive (ТЗ-корректировка): при регистрации пользователь выбирает
 * масштаб, и от этого зависит не только интерфейс, но и сложность всей
 * операционной модели. Пользователь не должен видеть сложность системы,
 * если ему она не нужна:
 *
 *   1. Домашний кондитер — заказы, календарь, простые остатки, рецепты,
 *      закупки, чат, доставка, отзывы, простая выручка.
 *   2. Кондитерская / ИП / ООО — + сотрудники, распределение заказов,
 *      себестоимость, склад, загрузка, расширенная аналитика.
 *   3. Ресторан / кофейня / сеть — + несколько площадок, смены, перемещения,
 *      SLA, прогнозирование, API.
 *
 * Смена масштаба меняет ТОЛЬКО подачу UI: движки lifecycle/capacity/risk
 * общие (см. src/lib/ops/) — это не вторая система.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Home, Loader2, Store, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import type { BusinessScale } from "@/lib/ops/lifecycle-client-types";

const SCALE_OPTIONS: Array<{
  value: BusinessScale;
  title: string;
  subtitle: string;
  features: string;
  icon: typeof Home;
}> = [
  {
    value: "home",
    title: "Домашний кондитер",
    subtitle: "Работаю самостоятельно или с небольшим количеством заказов",
    features: "Заказы · календарь · простые остатки · рецепты · закупки · чат · доставка · отзывы · простая выручка",
    icon: Home,
  },
  {
    value: "business",
    title: "Кондитерская / ИП / ООО",
    subtitle: "Есть сотрудники, несколько исполнителей или регулярный поток заказов",
    features: "+ сотрудники · распределение заказов · себестоимость · склад · производственная загрузка · расширенная аналитика",
    icon: Store,
  },
  {
    value: "enterprise",
    title: "Ресторан / кофейня / сеть",
    subtitle: "Несколько точек или большой поток заказов",
    features: "+ несколько площадок · смены · перемещения · централизованные закупки · SLA · прогнозирование",
    icon: Network,
  },
];

async function fetchScale(): Promise<BusinessScale> {
  const res = await csrfFetch("/api/confectioner/scale");
  if (!res.ok) throw new Error("Не удалось загрузить масштаб бизнеса");
  const body = (await res.json()) as { scale?: string };
  const scale = body.scale;
  if (scale === "business" || scale === "enterprise") return scale;
  return "home";
}

export function ConfectionerScaleSettings() {
  const queryClient = useQueryClient();

  const scaleQuery = useQuery({
    queryKey: ["confectioner-scale"],
    queryFn: fetchScale,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (scale: BusinessScale) => {
      const res = await csrfFetch("/api/confectioner/scale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || `Не получилось (HTTP ${res.status})`);
      }
      return scale;
    },
    onSuccess: async (scale) => {
      toast.success(
        scale === "home"
          ? "Простой режим включён — экран «Сегодня» станет проще"
          : scale === "business"
            ? "Расширенный режим включён — добавились загрузка и распределение заказов"
            : "Полный режим включён — доступен Operations Center"
      );
      await queryClient.invalidateQueries({ queryKey: ["confectioner-scale"] });
      await queryClient.invalidateQueries({ queryKey: ["ops-today"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const current = scaleQuery.data;

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="font-semibold text-base">Профиль возможностей</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Сложность находится внутри системы, а не перекладывается на вас. Выберите
        масштаб — интерфейс подстроится. Изменить можно в любой момент.
      </p>

      {scaleQuery.isLoading ? (
        <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Загружаем…
        </div>
      ) : (
        <div
          className="mt-4 grid gap-3 md:grid-cols-3"
          role="radiogroup"
          aria-label="Масштаб бизнеса"
        >
          {SCALE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={mutation.isPending}
                onClick={() => {
                  if (!selected) mutation.mutate(opt.value);
                }}
                className={`relative text-left rounded-xl border p-4 transition-colors min-h-[44px] ${
                  selected
                    ? "border-emerald-500 bg-emerald-50/60"
                    : "border-border hover:border-emerald-300 hover:bg-muted/40"
                } ${mutation.isPending ? "opacity-70" : ""}`}
              >
                {selected && (
                  <span className="absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="font-medium text-sm">{opt.title}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{opt.subtitle}</p>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  {opt.features}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        Первый уровень никогда не покажет слова «производственный план» или «ёмкость» —
        только «что сделать сейчас». Второй и третий включают инструменты по мере роста.
      </p>

      {mutation.isPending && (
        <Button disabled className="mt-3">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> Сохраняем…
        </Button>
      )}
    </Card>
  );
}
