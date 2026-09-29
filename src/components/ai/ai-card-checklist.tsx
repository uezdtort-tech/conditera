"use client";

/**
 * AiCardChecklist — чек-лист качества карточки товара (сценарий №6 из AI-макета).
 *
 * Проверяет заполненность карточки продавцом (rule-based, без LLM-вызова):
 *   • фото: ≥3 (целый торт, разрез, детали) и подсказки про ракурсы;
 *   • состав и аллергены заполнены;
 *   • вес, порции, срок изготовления;
 *   • условия хранения и срок годности;
 *   • описание ≥200 символов, теги.
 *
 * Располагается в форме товара кабинета продавца. Публикация — только после
 * проверки мастером; ИИ ничего не публикует сам.
 */

export interface CardChecklistForm {
  title: string;
  description: string;
  price: number;
  images: string[];
  tags: string[];
  weight: string;
  servings: number;
  prepTime: string;
  composition: {
    ingredients: string[];
    allergens: string[];
    storageConditions?: string;
    shelfLife?: string;
  };
}

interface CheckItem {
  label: string;
  ok: boolean;
  hint?: string;
}

export function computeCardScore(form: CardChecklistForm): { items: CheckItem[]; score: number } {
  const items: CheckItem[] = [
    {
      label: "Фотографий ≥ 3 (целый торт, разрез, детали декора)",
      ok: form.images.length >= 3,
      hint: "Добавьте фото разреза и текстуры — покупатели выбирают по ним",
    },
    {
      label: "Указан состав ингредиентов",
      ok: form.composition.ingredients.length > 0,
      hint: "Состав обязателен: по нему ИИ отвечает покупателям и работает фильтр аллергенов",
    },
    {
      label: "Указаны аллергены",
      ok: form.composition.allergens.length > 0,
      hint: "Если аллергенов нет — отметьте это в составе словами «без аллергенов из списка»",
    },
    {
      label: "Вес и число порций заполнены",
      ok: !!form.weight.trim() && form.servings > 0,
      hint: "Вес и порции нужны для подбора «на N человек»",
    },
    {
      label: "Срок изготовления указан",
      ok: !!form.prepTime.trim(),
      hint: "Например: «24 часа» — покупатели планируют дату по этому полю",
    },
    {
      label: "Условия хранения / срок годности",
      ok: !!form.composition.storageConditions?.trim() || !!form.composition.shelfLife?.trim(),
      hint: "Хранение и срок годности повышают доверие и снижают споры",
    },
    {
      label: "Описание ≥ 200 символов",
      ok: form.description.trim().length >= 200,
      hint: "Раскройте вкус, текстуру, поводы — или сгенерируйте черновик через ИИ и отредактируйте",
    },
    {
      label: "Есть теги (2+)",
      ok: form.tags.length >= 2,
      hint: "Теги помогают находить товар в поиске и фильтрах",
    },
  ];
  const score = Math.round((items.filter((i) => i.ok).length / items.length) * 100);
  return { items, score };
}

export function AiCardChecklist({ form }: { form: CardChecklistForm }) {
  const { items, score } = computeCardScore(form);
  const problems = items.filter((i) => !i.ok);

  return (
    <div className="rounded-lg border p-3 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Качество карточки</span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            score >= 80
              ? "bg-emerald-100 text-emerald-700"
              : score >= 50
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700"
          }`}
        >
          {score}%
        </span>
      </div>

      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-1.5 text-xs">
            <span className={item.ok ? "text-emerald-600" : "text-amber-600"} aria-hidden>
              {item.ok ? "✓" : "○"}
            </span>
            <span className={item.ok ? "text-muted-foreground" : "text-foreground"}>
              {item.label}
              {!item.ok && item.hint && (
                <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {problems.length === 0 && (
        <p className="text-[11px] text-emerald-700 mt-2">
          Карточка заполнена — покупателям и ИИ-подбору есть на что опираться.
        </p>
      )}
    </div>
  );
}
