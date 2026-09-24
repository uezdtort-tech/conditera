"use client";

/**
 * VisualSearchButton — кнопка поиска по фото (VLM).
 *
 * Размещается в шапке поиска (header) или в каталоге.
 * Пользователь загружает фото торта → VLM анализирует →
 * показывает найденные похожие товары.
 */
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Camera, Loader2, X, Search, Sparkles, Image as ImageIcon } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/finance";

interface SearchResult {
  id: string;
  title: string;
  price: number;
  images: string[];
  category?: string;
  rating: number;
  searchScore: number;
}

export function VisualSearchButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useAppStore((s) => s.navigate);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Файл слишком большой (макс 5 МБ)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImage(dataUrl);
      handleSearch(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSearch = async (imageData: string) => {
    setAnalyzing(true);
    setAnalysis(null);
    setResults([]);
    try {
      const res = await fetch("/api/visual-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData, limit: 12 }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
        setResults(data.products || []);
        if (data.usedVLM) {
          toast.success("Фото проанализировано через AI ✨");
        } else {
          toast.info("AI недоступен — показаны популярные товары");
        }
      } else {
        toast.error("Ошибка поиска");
      }
    } catch (err) {
      toast.error("Ошибка сети");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReset = () => {
    setImage(null);
    setAnalysis(null);
    setResults([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon" : "default"}
        onClick={() => setOpen(true)}
        title="Поиск по фото"
        className={compact ? "h-10 w-10" : "gap-1.5 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200"}
      >
        <Camera className="h-4 w-4 text-purple-600" />
        {!compact && <span className="text-sm">Поиск по фото</span>}
      </Button>

      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) handleReset();
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-purple-600" />
              Визуальный поиск
              <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                AI
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Загрузите фото торта — AI найдёт похожие товары в каталоге
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Загрузка фото */}
            {!image && (
              <label className="block cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-purple-200 rounded-xl p-12 text-center hover:border-purple-400 transition-colors bg-gradient-to-br from-purple-50 to-pink-50">
                  <div className="h-16 w-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3">
                    <ImageIcon className="h-8 w-8 text-purple-600" />
                  </div>
                  <p className="font-medium text-sm mb-1">Загрузите фото торта</p>
                  <p className="text-xs text-muted-foreground">
                    Перетащите файл или нажмите для выбора · JPG, PNG, WebP · макс 5 МБ
                  </p>
                </div>
              </label>
            )}

            {/* Превью + анализ */}
            {image && (
              <div className="flex gap-4">
                <div className="relative shrink-0">
                  <img
                    src={image}
                    alt="Загруженное фото"
                    className="h-32 w-32 rounded-lg object-cover border"
                  />
                  <button
                    onClick={handleReset}
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  {analyzing ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI анализирует изображение (5-10 сек)...
                    </div>
                  ) : analysis ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        <span className="text-sm font-medium">AI-анализ:</span>
                        {analysis.style && (
                          <Badge variant="outline" className="text-[10px]">{analysis.style}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{analysis.description}</p>
                      {analysis.colors?.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Цвета:</span>
                          {analysis.colors.map((c: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                          ))}
                        </div>
                      )}
                      {analysis.tags?.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">Теги:</span>
                          {analysis.tags.map((t: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] bg-purple-50">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Результаты поиска */}
            {results.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Search className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">
                    Найдено похожих: {results.length}
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setOpen(false);
                        navigate("product", { id: p.id });
                      }}
                      className="border rounded-lg overflow-hidden hover:border-primary/40 transition-colors text-left group"
                    >
                      <div className="aspect-square bg-muted relative">
                        {p.images?.[0] && (
                          <img
                            src={p.images[0]}
                            alt={p.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        )}
                        {p.searchScore > 0 && (
                          <Badge className="absolute top-1 right-1 text-[9px] bg-emerald-500 text-white">
                            {p.searchScore}% совп.
                          </Badge>
                        )}
                      </div>
                      <div className="p-2">
                        <div className="text-xs font-medium line-clamp-2 mb-1">{p.title}</div>
                        <div className="text-xs font-bold text-primary">
                          {formatCurrency(p.price)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Загрузка результатов */}
            {analyzing && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border rounded-lg overflow-hidden">
                    <div className="aspect-square bg-muted animate-pulse" />
                    <div className="p-2 space-y-1">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                      <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
