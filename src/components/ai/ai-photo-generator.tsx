"use client";

/**
 * AiPhotoGenerator — компонент для генерации фото тортов через AI.
 *
 * Кондитер описывает торт словами → AI генерирует изображение →
 * можно добавить в галерею товара.
 *
 * Используется:
 *   - В дашборде кондитера (отдельный виджет или в редакторе товара)
 *   - В Command Palette (быстрое действие "Сгенерировать фото торта")
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sparkles, Loader2, Download, RefreshCw, Check, ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface AiPhotoStyle {
  id: string;
  label: string;
  description: string;
}

interface AiPhotoSize {
  id: string;
  label: string;
}

export function AiPhotoGenerator({
  productId,
  onImageGenerated,
}: {
  productId?: string;
  onImageGenerated?: (imageUrl: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("modern");
  const [size, setSize] = useState("1024x1024");
  const [styles, setStyles] = useState<AiPhotoStyle[]>([]);
  const [sizes, setSizes] = useState<AiPhotoSize[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const res = await fetch("/api/products/ai-photo");
      if (res.ok) {
        const data = await res.json();
        setStyles(data.styles || []);
        setSizes(data.sizes || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerate = async () => {
    if (description.length < 5) {
      toast.error("Опишите торт подробнее (минимум 5 символов)");
      return;
    }
    setGenerating(true);
    setGeneratedUrl(null);
    setAttached(false);
    try {
      const res = await fetch("/api/products/ai-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          style,
          size,
          productId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedUrl(data.imageUrl);
        if (data.cached) {
          toast.info("Изображение найдено в кэше");
        } else if (data.fallback) {
          toast.warning("AI недоступен — использовано stock-фото");
        } else {
          toast.success("Фото сгенерировано через AI ✨");
        }
        if (data.attachedToProduct) {
          setAttached(true);
          onImageGenerated?.(data.imageUrl);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Ошибка генерации");
      }
    } catch (err) {
      toast.error("Ошибка сети");
    } finally {
      setGenerating(false);
    }
  };

  const handleAttachToProduct = async () => {
    if (!productId || !generatedUrl) return;
    setAttaching(true);
    try {
      // Повторно вызываем с теми же параметрами — сервер прикрепит к товару
      const res = await fetch("/api/products/ai-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          style,
          size,
          productId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.attachedToProduct || data.cached) {
          setAttached(true);
          onImageGenerated?.(data.imageUrl);
          toast.success("Фото добавлено в галерею товара");
        }
      }
    } catch (err) {
      toast.error("Ошибка");
    } finally {
      setAttaching(false);
    }
  };

  const handleDownload = async () => {
    if (!generatedUrl) return;
    try {
      const a = document.createElement("a");
      a.href = generatedUrl;
      a.download = `cake-ai-${Date.now()}.png`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Скачивание начато");
    } catch (err) {
      toast.error("Не удалось скачать");
    }
  };

  // Примеры описаний для быстрого старта
  const examples = [
    "Трёхъярусный свадебный торт, белый с кремовыми розами, золотые акценты",
    "Шоколадный торт с малиной, глянцевая глазурь, свежие ягоды сверху",
    "Минимальный торт с надписью 'С днём рождения', пастельные тона",
    "Красный бархат с крем-чизом, украшен свежей клубникой",
    "Торт в виде цифры 5, розовый с посыпкой, детский праздник",
  ];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            AI-генерация фото торта
            <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
              NEW
            </Badge>
          </h3>
          <p className="text-xs text-muted-foreground">
            Опишите торт словами — AI создаст профессиональное фото
          </p>
        </div>
      </div>

      {/* Описание */}
      <div>
        <Label htmlFor="ai-description" className="text-sm font-medium">
          Описание торта
        </Label>
        <Textarea
          id="ai-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Например: Трёхъярусный свадебный торт, белый с кремовыми розами, золотые акценты..."
          className="mt-1 min-h-[80px]"
          maxLength={500}
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">
            {description.length} / 500 символов
          </span>
          {description.length === 0 && (
            <div className="flex flex-wrap gap-1">
              {examples.slice(0, 2).map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setDescription(ex)}
                  className="text-[10px] text-purple-600 hover:text-purple-800 underline"
                >
                  Пример {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Стиль */}
      <div>
        <Label className="text-sm font-medium">Стиль фотографии</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
          {styles.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={`text-left p-2 rounded-lg border text-xs transition-colors ${
                style === s.id
                  ? "border-purple-400 bg-purple-50"
                  : "border-border hover:border-purple-200"
              }`}
            >
              <div className="font-medium">{s.label}</div>
              <div className="text-[10px] text-muted-foreground">{s.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Размер */}
      <div>
        <Label className="text-sm font-medium">Размер</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {sizes.map((s) => (
            <button
              key={s.id}
              onClick={() => setSize(s.id)}
              className={`px-3 py-1 rounded-md border text-xs transition-colors ${
                size === s.id
                  ? "border-purple-400 bg-purple-50 text-purple-700"
                  : "border-border hover:border-purple-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Кнопка генерации */}
      <Button
        onClick={handleGenerate}
        disabled={generating || description.length < 5}
        className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Генерация (15-30 сек)...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Сгенерировать фото
          </>
        )}
      </Button>

      {/* Результат */}
      {generatedUrl && (
        <div className="space-y-3 pt-3 border-t">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">Результат</span>
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
              готово
            </Badge>
          </div>

          <div className="relative rounded-lg overflow-hidden border bg-muted/30">
            <img
              src={generatedUrl}
              alt="AI-сгенерированный торт"
              className="w-full max-h-96 object-contain"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              className="gap-1"
            >
              <Download className="h-3.5 w-3.5" />
              Скачать PNG
            </Button>
            {productId && !attached && (
              <Button
                size="sm"
                onClick={handleAttachToProduct}
                disabled={attaching}
                className="gap-1"
              >
                {attaching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Добавить в галерею товара
              </Button>
            )}
            {attached && (
              <Badge className="bg-emerald-100 text-emerald-800 gap-1">
                <Check className="h-3 w-3" />
                Добавлено в товар
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleGenerate}
              disabled={generating}
              className="gap-1"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Сгенерировать заново
            </Button>
          </div>
        </div>
      )}

      {/* Подсказки */}
      <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
        💡 Совет: чем подробнее описание (количество ярусов, цвет, украшения, повод), тем точнее результат.
        AI не добавляет текст на торт — для надписей используйте редактор товара.
      </div>
    </Card>
  );
}
