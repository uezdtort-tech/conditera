"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Cake, Save, RefreshCw, AlertCircle, CheckCircle2, Search,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { CakeSliceVisualizer, type SliceConfig } from "@/components/cake-slice/cake-slice-visualizer";

interface Filling {
  id: string;
  name: string;
  description: string;
  category: string;
  color?: string;
  consistency?: string;
  sliceImage?: string | null;
  sliceConfig?: SliceConfig | null;
  status: string;
}

interface Product {
  id: string;
  title: string;
  fillings?: { name: string; priceModifier: number }[];
}

export function ConfectionerSliceEditorTab() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const products = useAppStore((s) => s.products);
  const [fillings, setFillings] = useState<Filling[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"fillings" | "products">("fillings");

  // Локальное состояние правок
  const [edits, setEdits] = useState<Record<string, { config?: SliceConfig; image?: string }>>({});

  useEffect(() => {
    loadFillings();
  }, []);

  const loadFillings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fillings?status=APPROVED");
      if (res.ok) {
        const data = await res.json();
        setFillings(data.fillings || []);
      } else {
        // Fallback на mock-данные
        setFillings(MOCK_FILLINGS);
      }
    } catch (err) {
      setFillings(MOCK_FILLINGS);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (filling: Filling) => {
    const edit = edits[filling.id];
    if (!edit) {
      toast.info("Нет изменений для сохранения");
      return;
    }
    setSavingId(filling.id);
    try {
      const res = await fetch(`/api/fillings/${filling.id}/slice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sliceImage: edit.image,
          sliceConfig: edit.config,
        }),
      });
      if (res.ok) {
        toast.success(`Срез для «${filling.name}» сохранён`);
        // Очищаем правки
        const newEdits = { ...edits };
        delete newEdits[filling.id];
        setEdits(newEdits);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Ошибка сохранения");
      }
    } catch (err) {
      toast.error("Ошибка сети");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfigChange = (fillingId: string, config: SliceConfig, image?: string) => {
    setEdits({
      ...edits,
      [fillingId]: { ...edits[fillingId], config, image },
    });
  };

  const filtered = fillings.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.description.toLowerCase().includes(search.toLowerCase())
  );

  // Кондитерские продукты этого пользователя
  const myProducts = products.filter(
    (p: any) => p.confectionerId === user?.id || p.fillings?.length
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Cake className="h-6 w-6 text-primary" />
          Срезы тортов по начинкам
        </h1>
        <Button variant="outline" size="sm" onClick={loadFillings} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          Обновить
        </Button>
      </div>

      {/* Info */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Новый тренд: клиенты хотят видеть срез торта перед заказом</p>
            <p className="text-muted-foreground">
              Для каждой начинки добавьте изображение среза — это повышает конверсию и снижает возвраты.
              Вы можете смоделировать срез через визуализатор (быстро, шаблонные пресеты) или загрузить
              фотографию реального торта.
            </p>
          </div>
        </div>
      </Card>

      {/* Переключатель вкладок */}
      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "fillings"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("fillings")}
        >
          Начинки ({fillings.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "products"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("products")}
        >
          Мои товары ({myProducts.length})
        </button>
      </div>

      {activeTab === "fillings" && (
        <>
          {/* Поиск */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по начинкам..."
              className="pl-10"
            />
          </div>

          {loading ? (
            <Card className="p-8 text-center text-muted-foreground">
              Загрузка начинок...
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <Cake className="h-12 w-12 mx-auto mb-2 opacity-40" />
              Начинки не найдены
            </Card>
          ) : (
            <div className="space-y-4">
              {filtered.map((filling) => {
                const hasEdit = !!edits[filling.id];
                return (
                  <Card key={filling.id} className={`p-4 ${hasEdit ? "border-amber-300 bg-amber-50/30" : ""}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{filling.name}</h3>
                          <Badge variant="outline" className="text-[10px]">{filling.category}</Badge>
                          {filling.sliceImage && !hasEdit && (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] gap-1">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              фото загружено
                            </Badge>
                          )}
                          {filling.sliceConfig && !filling.sliceImage && !hasEdit && (
                            <Badge variant="secondary" className="text-[10px]">
                              модель
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {filling.description}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSave(filling)}
                        disabled={!hasEdit || savingId === filling.id}
                        className="gap-1 shrink-0"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingId === filling.id ? "Сохранение..." : "Сохранить"}
                      </Button>
                    </div>

                    <CakeSliceVisualizer
                      filling={filling}
                      editable
                      onChange={(config, image) => handleConfigChange(filling.id, config, image)}
                    />

                    {hasEdit && (
                      <div className="mt-3 pt-3 border-t border-amber-200 text-xs text-amber-700">
                        ⚠️ Есть несохранённые изменения. Нажмите «Сохранить», чтобы применить.
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === "products" && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">Срезы по товарам</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Загрузите срез для конкретного товара (а не для начинки в общем).
              Это полезно, если у вас уникальная подача начинки в конкретном торте.
            </p>
            {myProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Cake className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">У вас пока нет товаров с начинками</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("catalog")}>
                  Перейти к товарам
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {myProducts.map((product: any) => (
                  <Card key={product.id} className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {product.images?.[0] && (
                        <img
                          src={product.images[0]}
                          alt={product.title}
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{product.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.fillings?.length || 0} начинок
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate("product", { id: product.id })}
                    >
                      Открыть товар
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// Mock-начинки для dev/fallback
const MOCK_FILLINGS: Filling[] = [
  {
    id: "f1",
    name: "Шоколадный бисквит + ганаш",
    description: "Классическое сочетание: насыщенный шоколадный бисквит с прослойкой тёмного ганаша на 70% шоколаде.",
    category: "CHOCOLATE",
    color: "#3d2817",
    consistency: "плотный, влажный",
    status: "APPROVED",
  },
  {
    id: "f2",
    name: "Ванильный бисквит + маскарпоне",
    description: "Воздушный ванильный бисквит с натуральной ванилью Бурбон и кремом из маскарпоне.",
    category: "CREAM",
    color: "#f4e4c1",
    consistency: "воздушный",
    status: "APPROVED",
  },
  {
    id: "f3",
    name: "Красный бархат + сливочный сыр",
    description: "Знаменитый красный бисквит с лёгкой шоколадной ноткой и классическим кремом из сливочного сыра.",
    category: "CREAM",
    color: "#a4161a",
    consistency: "бархатистый",
    status: "APPROVED",
  },
  {
    id: "f4",
    name: "Клубничный конфитюр + сливки",
    description: "Свежая клубника в конфитюре с взбитыми сливками 33% на бисквитной основе.",
    category: "BERRY",
    color: "#dc2626",
    consistency: "ягодная",
    status: "APPROVED",
  },
  {
    id: "f5",
    name: "Солёная карамель + бисквит",
    description: "Карамельный бисквит с прослойкой солёной карамели и крем-чизом.",
    category: "CARAMEL",
    color: "#92400e",
    consistency: "влажный",
    status: "APPROVED",
  },
];
