"use client";

/**
 * AiDescriptionGenerator — кнопка + модалка для генерации описания товара через AI.
 *
 * Используется в редакторе товара (ConfectionerCatalogManager или форма создания).
 * Кондитер вводит базовые данные → AI генерирует продающее описание + теги + SEO.
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, Check, RefreshCw, Tag } from "lucide-react";
import { toast } from "sonner";

interface AiDescriptionGeneratorProps {
  title: string;
  category?: string;
  fillings?: string[];
  weight?: string;
  servings?: number;
  price?: number;
  onApply: (data: {
    description: string;
    shortDescription?: string;
    tags?: string[];
    seoKeywords?: string[];
  }) => void;
}

const TONE_LABELS: Record<string, string> = {
  selling: "Продающий",
  elegant: "Элегантный",
  playful: "Игривый",
  minimal: "Минималистичный",
};

export function AiDescriptionGenerator({
  title,
  category,
  fillings = [],
  weight,
  servings,
  price,
  onApply,
}: AiDescriptionGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState("selling");
  const [maxLength, setMaxLength] = useState(500);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleGenerate = async () => {
    if (!title || title.length < 3) {
      toast.error("Сначала укажите название товара (минимум 3 символа)");
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch("/api/products/ai-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          fillings,
          weight,
          servings,
          price,
          tone,
          maxLength,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        if (data.generatedBy === "llm") {
          toast.success("Описание сгенерировано через AI ✨");
        } else {
          toast.info("AI недоступен — использован шаблон");
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

  const handleApply = () => {
    if (!result) return;
    onApply({
      description: result.description,
      shortDescription: result.shortDescription,
      tags: result.tags,
      seoKeywords: result.seoKeywords,
    });
    toast.success("Описание применено к товару");
    setOpen(false);
    setResult(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200 hover:border-purple-400"
      >
        <Sparkles className="h-3.5 w-3.5 text-purple-600" />
        AI-описание
      </Button>

      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) setResult(null);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              AI-генерация описания
            </DialogTitle>
            <DialogDescription>
              LLM создаст продающее описание на основе данных о товаре
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Тон */}
            <div>
              <Label className="text-sm font-medium">Тон описания</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                {Object.entries(TONE_LABELS).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTone(id)}
                    className={`p-2 rounded-lg border text-xs transition-colors ${
                      tone === id
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-border hover:border-purple-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Макс. длина */}
            <div>
              <Label className="text-sm font-medium">
                Максимальная длина: {maxLength} символов
              </Label>
              <Input
                type="range"
                min={200}
                max={1500}
                step={100}
                value={maxLength}
                onChange={(e) => setMaxLength(parseInt(e.target.value))}
                className="mt-1"
              />
            </div>

            {/* Предпросмотр входных данных */}
            <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
              <div><b>Название:</b> {title || "—"}</div>
              <div><b>Категория:</b> {category || "—"}</div>
              <div><b>Начинки:</b> {fillings.length > 0 ? fillings.join(", ") : "—"}</div>
              <div><b>Вес:</b> {weight || "—"} · <b>Порций:</b> {servings || "—"} · <b>Цена:</b> {price ? `${price} ₽` : "—"}</div>
            </div>

            {/* Кнопка генерации */}
            <Button
              onClick={handleGenerate}
              disabled={generating || !title}
              className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Генерация (5-15 сек)...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Сгенерировать описание
                </>
              )}
            </Button>

            {/* Результат */}
            {result && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Результат</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      result.generatedBy === "llm"
                        ? "bg-purple-50 text-purple-700 border-purple-200"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {result.generatedBy === "llm" ? "AI ✨" : "Шаблон"}
                  </Badge>
                </div>

                {/* Полное описание */}
                <div>
                  <Label className="text-xs text-muted-foreground">Описание ({result.description.length} симв.)</Label>
                  <Textarea
                    value={result.description}
                    onChange={(e) => setResult({ ...result, description: e.target.value })}
                    className="mt-1 min-h-[120px] text-sm"
                  />
                </div>

                {/* Краткое описание */}
                {result.shortDescription && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Краткое (для превью)</Label>
                    <Input
                      value={result.shortDescription}
                      onChange={(e) => setResult({ ...result, shortDescription: e.target.value })}
                      className="mt-1 text-sm"
                    />
                  </div>
                )}

                {/* Теги */}
                {result.tags?.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      Предложенные теги
                    </Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.tags.map((tag: string, i: number) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-[10px] bg-purple-50 text-purple-700 border-purple-200"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* SEO-ключевые слова */}
                {result.seoKeywords?.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      SEO-ключевые слова ({result.seoKeywords.length})
                    </summary>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {result.seoKeywords.map((kw: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {kw}
                        </Badge>
                      ))}
                    </div>
                  </details>
                )}

                {/* Действия */}
                <div className="flex gap-2">
                  <Button onClick={handleApply} className="flex-1 gap-1">
                    <Check className="h-4 w-4" />
                    Применить к товару
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="gap-1"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Заново
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
