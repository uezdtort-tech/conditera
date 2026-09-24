"use client";

/**
 * SmartFilters — умные фильтры каталога (раздел 30, 62).
 *
 * Компактная панель фильтров: категории, цена, рейтинг, dietary, eco.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X, Star, Leaf, MapPin } from "lucide-react";

export interface SmartFiltersValue {
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  dietary?: string[];
  isLocal?: boolean;
  hasPickup?: boolean;
  sort?: string;
}

interface SmartFiltersProps {
  categories?: Array<{ slug: string; name: string; icon?: string }>;
  value: SmartFiltersValue;
  onChange: (value: SmartFiltersValue) => void;
}

const DIETARY_OPTIONS = [
  { id: "sugar_free", label: "Без сахара" },
  { id: "gluten_free", label: "Без глютена" },
  { id: "vegan", label: "Веганский" },
  { id: "keto", label: "Кето" },
];

const SORT_OPTIONS = [
  { id: "newest", label: "Сначала новые" },
  { id: "price_asc", label: "Дешевле" },
  { id: "price_desc", label: "Дороже" },
  { id: "rating", label: "По рейтингу" },
  { id: "popular", label: "Популярные" },
];

export function SmartFilters({ categories = [], value, onChange }: SmartFiltersProps): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false);
  const activeCount = [
    value.categorySlug,
    value.minPrice !== undefined,
    value.maxPrice !== undefined,
    value.minRating !== undefined,
    value.dietary && value.dietary.length > 0,
    value.isLocal,
    value.hasPickup,
  ].filter(Boolean).length;

  const toggleDietary = (id: string): void => {
    const current = value.dietary || [];
    onChange({ ...value, dietary: current.includes(id) ? current.filter((d) => d !== id) : [...current, id] });
  };

  const clearAll = (): void => onChange({ sort: value.sort });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setIsOpen(!isOpen)} className="gap-1">
        <SlidersHorizontal className="h-4 w-4" />
        Фильтры
        {activeCount > 0 && <Badge variant="secondary" className="text-[10px] ml-1">{activeCount}</Badge>}
      </Button>

      {isOpen && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">Фильтры</span>
            <div className="flex items-center gap-2">
              {activeCount > 0 && <Button size="sm" variant="ghost" onClick={clearAll} className="text-xs">Очистить</Button>}
              <Button size="icon" variant="ghost" onClick={() => setIsOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Категория</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {categories.map((cat) => (
                  <button key={cat.slug} onClick={() => onChange({ ...value, categorySlug: value.categorySlug === cat.slug ? undefined : cat.slug })}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${value.categorySlug === cat.slug ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/30"}`}>
                    {cat.icon} {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-xs font-medium text-muted-foreground">Цена (₽)</span>
            <div className="flex gap-2 mt-1.5">
              <input type="number" placeholder="от" value={value.minPrice || ""} onChange={(e) => onChange({ ...value, minPrice: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-24 px-2 py-1 text-xs border rounded" />
              <input type="number" placeholder="до" value={value.maxPrice || ""} onChange={(e) => onChange({ ...value, maxPrice: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-24 px-2 py-1 text-xs border rounded" />
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Рейтинг</span>
            <div className="flex gap-1 mt-1.5">
              {[3, 4, 4.5, 5].map((r) => (
                <button key={r} onClick={() => onChange({ ...value, minRating: value.minRating === r ? undefined : r })}
                  className={`px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1 ${value.minRating === r ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/30"}`}>
                  <Star className="h-3 w-3" /> {r}+
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Диета</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {DIETARY_OPTIONS.map((opt) => (
                <button key={opt.id} onClick={() => toggleDietary(opt.id)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${value.dietary?.includes(opt.id) ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/30"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => onChange({ ...value, isLocal: !value.isLocal })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${value.isLocal ? "bg-blue-500 text-white border-blue-500" : "hover:border-primary/30"}`}>
              <MapPin className="h-3 w-3" /> Локальные
            </button>
            <button onClick={() => onChange({ ...value, hasPickup: !value.hasPickup })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${value.hasPickup ? "bg-green-500 text-white border-green-500" : "hover:border-primary/30"}`}>
              <Leaf className="h-3 w-3" /> Самовывоз
            </button>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Сортировка</span>
            <select value={value.sort || "newest"} onChange={(e) => onChange({ ...value, sort: e.target.value })}
              className="w-full mt-1.5 px-2 py-1 text-xs border rounded">
              {SORT_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
          </div>
        </Card>
      )}
    </>
  );
}
