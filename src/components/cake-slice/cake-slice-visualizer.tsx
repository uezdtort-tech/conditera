"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Cake, Upload, Edit3, Trash2, Plus, Download, Eye, X, Sparkles, Loader2, Image as ImageIcon, Boxes,
} from "lucide-react";
import { toast } from "sonner";

// ===== Типы =====
export interface SliceLayer {
  type: "biscuit" | "cream" | "berry" | "chocolate" | "mousse" | "caramel" | "fruit" | "nuts";
  color: string;
  label: string;
  height?: number; // относительная высота (1-5)
}

export interface SliceConfig {
  layers: SliceLayer[];
  coating?: { color: string; label: string };
  decoration?: { type: "berries" | "chocolate" | "nuts" | "sprinkles"; color: string };
  shape?: "round" | "square";
}

interface Filling {
  id?: string;
  name: string;
  color?: string;
  consistency?: string;
  sliceImage?: string | null;
  sliceConfig?: SliceConfig | null;
}

// ===== Preset-конфигурации по типам начинок =====
const PRESETS: Record<string, SliceConfig> = {
  // Шоколадный бисквит + ганаш
  chocolate: {
    layers: [
      { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
      { type: "cream", color: "#1a0d08", label: "Ганаш тёмный", height: 1 },
      { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
      { type: "cream", color: "#5c3925", label: "Шоколадный крем", height: 1 },
    ],
    coating: { color: "#1a0d08", label: "Ганаш" },
    decoration: { type: "chocolate", color: "#3d2817" },
    shape: "round",
  },
  // Ванильный бисквит + маскарпоне
  vanilla: {
    layers: [
      { type: "biscuit", color: "#f4e4c1", label: "Ванильный бисквит", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Крем маскарпоне", height: 1 },
      { type: "biscuit", color: "#f4e4c1", label: "Ванильный бисквит", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Крем маскарпоне", height: 1 },
    ],
    coating: { color: "#fffaeb", label: "Крем-чиз" },
    decoration: { type: "berries", color: "#dc2626" },
    shape: "round",
  },
  // Красный бархат + сливочный сыр
  red_velvet: {
    layers: [
      { type: "biscuit", color: "#a4161a", label: "Красный бархат", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Сливочный сыр", height: 1 },
      { type: "biscuit", color: "#a4161a", label: "Красный бархат", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Сливочный сыр", height: 1 },
    ],
    coating: { color: "#fffaeb", label: "Сливочный сыр" },
    decoration: { type: "sprinkles", color: "#a4161a" },
    shape: "round",
  },
  // Ягодный (клубника/малина)
  berry: {
    layers: [
      { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
      { type: "berry", color: "#dc2626", label: "Клубничный конфитюр", height: 1 },
      { type: "cream", color: "#fffaeb", label: "Крем-чиз", height: 1 },
      { type: "berry", color: "#dc2626", label: "Свежая клубника", height: 1 },
    ],
    coating: { color: "#fffaeb", label: "Крем-чиз" },
    decoration: { type: "berries", color: "#dc2626" },
    shape: "round",
  },
  // Карамель
  caramel: {
    layers: [
      { type: "biscuit", color: "#d4a574", label: "Карамельный бисквит", height: 3 },
      { type: "caramel", color: "#92400e", label: "Солёная карамель", height: 1 },
      { type: "cream", color: "#fef3c7", label: "Крем-чиз", height: 2 },
    ],
    coating: { color: "#fef3c7", label: "Крем-чиз" },
    decoration: { type: "nuts", color: "#92400e" },
    shape: "round",
  },
  // По умолчанию
  default: {
    layers: [
      { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Крем", height: 2 },
      { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
    ],
    coating: { color: "#fffaeb", label: "Крем" },
    shape: "round",
  },
};

// Выбор пресета по имени/цвету начинки
function detectPreset(filling: Filling): SliceConfig {
  const name = filling.name.toLowerCase();
  if (name.includes("шоколад") || name.includes("chocolate")) return PRESETS.chocolate;
  if (name.includes("ванил") || name.includes("vanilla")) return PRESETS.vanilla;
  if (name.includes("бархат") || name.includes("velvet")) return PRESETS.red_velvet;
  if (name.includes("ягод") || name.includes("клубник") || name.includes("малин") || name.includes("berry")) return PRESETS.berry;
  if (name.includes("карамел") || name.includes("caramel")) return PRESETS.caramel;
  return PRESETS.default;
}

// ===== SVG-рендер среза торта =====
function SliceSVG({ config, size = 200 }: { config: SliceConfig; size?: number }) {
  const layers = config.layers || [];
  const totalHeight = layers.reduce((sum, l) => sum + (l.height || 1) * 20, 0);
  const w = size;
  const h = Math.max(totalHeight + 30, size * 0.8);
  const cx = w / 2;

  // Рисуем слои как прямоугольники с закруглёнными краями
  let yOffset = 20;
  const layerRects = layers.map((layer, i) => {
    const layerH = (layer.height || 1) * 20;
    const rect = (
      <g key={i}>
        {/* Тело слоя */}
        <rect
          x={cx - w * 0.35}
          y={yOffset}
          width={w * 0.7}
          height={layerH}
          fill={layer.color}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={0.5}
        />
        {/* Текстура (зависит от типа) */}
        {layer.type === "berry" && (
          <>
            <circle cx={cx - 20} cy={yOffset + layerH / 2} r={3} fill="rgba(255,255,255,0.4)" />
            <circle cx={cx + 15} cy={yOffset + layerH / 2} r={2.5} fill="rgba(255,255,255,0.4)" />
            <circle cx={cx} cy={yOffset + layerH / 2 - 2} r={2} fill="rgba(255,255,255,0.3)" />
          </>
        )}
        {layer.type === "chocolate" && (
          <rect
            x={cx - w * 0.35}
            y={yOffset + 2}
            width={w * 0.7}
            height={1.5}
            fill="rgba(255,255,255,0.1)"
          />
        )}
        {layer.type === "biscuit" && (
          <g opacity={0.3}>
            <circle cx={cx - 25} cy={yOffset + 5} r={1} fill="rgba(0,0,0,0.4)" />
            <circle cx={cx + 10} cy={yOffset + 10} r={1.2} fill="rgba(0,0,0,0.4)" />
            <circle cx={cx - 5} cy={yOffset + 15} r={0.8} fill="rgba(0,0,0,0.4)" />
            <circle cx={cx + 25} cy={yOffset + 8} r={1} fill="rgba(0,0,0,0.4)" />
          </g>
        )}
        {layer.type === "nuts" && (
          <g opacity={0.5}>
            <ellipse cx={cx - 15} cy={yOffset + layerH / 2} rx={3} ry={2} fill="rgba(0,0,0,0.4)" />
            <ellipse cx={cx + 18} cy={yOffset + layerH / 2} rx={3} ry={2} fill="rgba(0,0,0,0.4)" />
          </g>
        )}
        {/* Лейбл */}
        <text
          x={cx + w * 0.4}
          y={yOffset + layerH / 2 + 4}
          fontSize={9}
          fill="#374151"
          fontFamily="sans-serif"
        >
          {layer.label}
        </text>
      </g>
    );
    yOffset += layerH;
    return rect;
  });

  // Покрытие сверху
  const coatingRect = config.coating ? (
    <rect
      x={cx - w * 0.35}
      y={10}
      width={w * 0.7}
      height={12}
      fill={config.coating.color}
      rx={2}
    />
  ) : null;

  // Декор сверху
  let decoration: React.ReactElement | null = null;
  if (config.decoration?.type === "berries") {
    decoration = (
      <g>
        <circle cx={cx - 15} cy={6} r={5} fill={config.decoration.color} />
        <circle cx={cx} cy={4} r={5} fill={config.decoration.color} />
        <circle cx={cx + 15} cy={6} r={5} fill={config.decoration.color} />
        <circle cx={cx - 7} cy={2} r={2} fill="#22c55e" />
        <circle cx={cx + 8} cy={2} r={2} fill="#22c55e" />
      </g>
    );
  } else if (config.decoration?.type === "chocolate") {
    decoration = (
      <g>
        <path
          d={`M ${cx - 20} 8 Q ${cx - 10} 0, ${cx} 4 T ${cx + 20} 6`}
          fill="none"
          stroke={config.decoration.color}
          strokeWidth={3}
        />
      </g>
    );
  } else if (config.decoration?.type === "nuts") {
    decoration = (
      <g>
        <ellipse cx={cx - 12} cy={5} rx={3} ry={2.5} fill={config.decoration.color} />
        <ellipse cx={cx + 5} cy={4} rx={3} ry={2.5} fill={config.decoration.color} />
        <ellipse cx={cx + 15} cy={6} rx={3} ry={2.5} fill={config.decoration.color} />
      </g>
    );
  } else if (config.decoration?.type === "sprinkles") {
    decoration = (
      <g>
        <line x1={cx - 18} y1={4} x2={cx - 14} y2={8} stroke={config.decoration.color} strokeWidth={1.5} />
        <line x1={cx - 5} y1={2} x2={cx - 2} y2={7} stroke={config.decoration.color} strokeWidth={1.5} />
        <line x1={cx + 10} y1={3} x2={cx + 14} y2={8} stroke={config.decoration.color} strokeWidth={1.5} />
        <line x1={cx + 18} y1={5} x2={cx + 22} y2={9} stroke={config.decoration.color} strokeWidth={1.5} />
      </g>
    );
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Тарелка/подложка */}
      <ellipse cx={cx} cy={h - 8} rx={w * 0.4} ry={4} fill="#f3f4f6" />
      {/* Тень */}
      <ellipse cx={cx} cy={h - 5} rx={w * 0.38} ry={3} fill="rgba(0,0,0,0.08)" />

      {/* Боковые стенки покрытия */}
      {config.coating && (
        <>
          <rect
            x={cx - w * 0.35}
            y={10}
            width={3}
            height={totalHeight + 8}
            fill={config.coating.color}
            opacity={0.7}
          />
          <rect
            x={cx + w * 0.35 - 3}
            y={10}
            width={3}
            height={totalHeight + 8}
            fill={config.coating.color}
            opacity={0.7}
          />
        </>
      )}

      {coatingRect}
      {layerRects}
      {decoration}
    </svg>
  );
}

// ===== Генерация SVG-строки для экспорта в PNG =====
export function renderSliceSVGString(config: SliceConfig, size = 600): string {
  const layers = config.layers || [];
  const totalHeight = layers.reduce((sum, l) => sum + (l.height || 1) * 20, 0);
  const w = size;
  const h = Math.max(totalHeight + 30, size * 0.8);
  const cx = w / 2;

  let yOffset = 20;
  const layerRects = layers.map((layer, i) => {
    const layerH = (layer.height || 1) * 20;
    const rect = `
      <rect x="${cx - w * 0.35}" y="${yOffset}" width="${w * 0.7}" height="${layerH}" fill="${layer.color}" stroke="rgba(0,0,0,0.15)" stroke-width="0.5" />
      <text x="${cx + w * 0.4}" y="${yOffset + layerH / 2 + 4}" font-size="9" fill="#374151" font-family="sans-serif">${escapeXml(layer.label)}</text>`;
    yOffset += layerH;
    return rect;
  }).join("");

  const coating = config.coating
    ? `<rect x="${cx - w * 0.35}" y="10" width="${w * 0.7}" height="12" fill="${config.coating.color}" rx="2" />`
    : "";

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${cx}" cy="${h - 8}" rx="${w * 0.4}" ry="4" fill="#f3f4f6" />
    <ellipse cx="${cx}" cy="${h - 5}" rx="${w * 0.38}" ry="3" fill="rgba(0,0,0,0.08)" />
    ${coating}
    ${layerRects}
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  } as Record<string, string>)[c]);
}

// ===== Главный компонент: визуализатор =====
export function CakeSliceVisualizer({
  filling,
  productId,
  size = 200,
  editable = false,
  onChange,
}: {
  filling: Filling;
  productId?: string;
  size?: number;
  editable?: boolean;
  onChange?: (config: SliceConfig, image?: string) => void;
}) {
  const [config, setConfig] = useState<SliceConfig>(
    filling.sliceConfig || detectPreset(filling)
  );
  const [image, setImage] = useState<string | null>(filling.sliceImage || null);
  const [editMode, setEditMode] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setConfig(filling.sliceConfig || detectPreset(filling));
    setImage(filling.sliceImage || null);
  }, [filling]);

  const updateLayer = (i: number, updates: Partial<SliceLayer>) => {
    const newLayers = [...config.layers];
    newLayers[i] = { ...newLayers[i], ...updates };
    const newConfig = { ...config, layers: newLayers };
    setConfig(newConfig);
    onChange?.(newConfig, image || undefined);
  };

  const addLayer = () => {
    const newConfig = {
      ...config,
      layers: [
        ...config.layers,
        { type: "cream" as const, color: "#fffaeb", label: "Новый слой", height: 1 },
      ],
    };
    setConfig(newConfig);
    onChange?.(newConfig, image || undefined);
  };

  const removeLayer = (i: number) => {
    const newConfig = {
      ...config,
      layers: config.layers.filter((_, idx) => idx !== i),
    };
    setConfig(newConfig);
    onChange?.(newConfig, image || undefined);
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      onChange?.(config, dataUrl);
      toast.success("Изображение загружено");
    };
    reader.readAsDataURL(file);
  };

  const applyPreset = (presetName: keyof typeof PRESETS) => {
    const newConfig = PRESETS[presetName];
    setConfig(newConfig);
    onChange?.(newConfig, image || undefined);
    toast.success(`Применён пресет: ${presetName}`);
  };

  // === AI-генерация среза через LLM ===
  const handleAiGenerate = async () => {
    setAiGenerating(true);
    try {
      const res = await fetch("/api/fillings/ai-generate-slice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: filling.name,
          description: (filling as any).description || "",
          consistency: filling.consistency || "",
          color: filling.color || "",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
          onChange?.(data.config, image || undefined);
          toast.success(
            data.generatedBy === "llm"
              ? "Срез сгенерирован через AI ✨"
              : "Применён авто-пресет (LLM недоступна)",
            { description: data.explanation }
          );
        } else {
          toast.error("AI не смог сгенерировать срез");
        }
      } else {
        toast.error("Ошибка AI-генерации");
      }
    } catch (err) {
      toast.error("Ошибка сети при AI-генерации");
    } finally {
      setAiGenerating(false);
    }
  };

  // === Экспорт SVG → PNG ===
  const handleExportPng = async () => {
    setExporting(true);
    try {
      // Генерируем SVG-строку из текущего config
      const svgString = renderSliceSVGString(config, 600);

      const res = await fetch("/api/slice/export-png", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          svg: svgString,
          width: 600,
          height: 600,
          scale: 2,
        }),
      });

      if (res.ok && res.headers.get("Content-Type")?.includes("image/png")) {
        // Скачиваем PNG
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cake-slice-${filling.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("PNG скачан");
      } else if (res.status === 501) {
        // Playwright недоступен — fallback на canvas
        const data = await res.json();
        if (data.fallback === "client") {
          await exportPngClientSide(svgString);
        } else {
          toast.error("Серверный экспорт недоступен");
        }
      } else {
        toast.error("Ошибка экспорта");
      }
    } catch (err) {
      toast.error("Ошибка сети при экспорте");
    } finally {
      setExporting(false);
    }
  };

  // Fallback-экспорт PNG на клиенте через canvas
  const exportPngClientSide = async (svgString: string) => {
    try {
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context недоступен");

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Canvas toBlob failed");
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `cake-slice-${filling.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
        toast.success("PNG скачан (клиентский рендеринг)");
      }, "image/png");
    } catch (err) {
      toast.error("Клиентский экспорт не удался");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <Cake className="h-4 w-4 text-primary" />
            Срез торта
          </h4>
          <p className="text-xs text-muted-foreground">{filling.name}</p>
        </div>
        <div className="flex gap-1">
          {/* Экспорт PNG — доступен всегда */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleExportPng}
            disabled={exporting || !!image}
            title={image ? "Недоступно при загруженном фото" : "Скачать PNG для маркетинга"}
            className="gap-1"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            PNG
          </Button>
          {/* AI-генерация */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleAiGenerate}
            disabled={aiGenerating}
            title="Сгенерировать срез через AI по описанию начинки"
            className="gap-1 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200 hover:border-purple-400"
          >
            {aiGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-purple-600" />
            )}
            AI
          </Button>
          {/* Редактирование */}
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setEditMode(!editMode)}>
              <Edit3 className="h-3.5 w-3.5 mr-1" />
              {editMode ? "Готово" : "Изменить"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Превью среза */}
        <div className="shrink-0">
          {image ? (
            <div className="relative">
              <img
                src={image}
                alt={`Срез торта: ${filling.name}`}
                className="rounded-lg border object-cover"
                style={{ width: size, height: size }}
              />
              {editMode && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => {
                    setImage(null);
                    onChange?.(config, undefined);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ) : (
            <div
              className="rounded-lg border bg-muted/30 p-2 flex items-center justify-center"
              style={{ width: size, height: size }}
            >
              <SliceSVG config={config} size={size - 16} />
            </div>
          )}
        </div>

        {/* Редактор */}
        {editMode && (
          <div className="flex-1 space-y-3">
            {/* Загрузка фото */}
            <div>
              <Label className="text-xs">Фотография среза (заменяет модель)</Label>
              <div className="flex gap-2 mt-1">
                <label className="flex-1 cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadImage}
                    className="hidden"
                  />
                  <div className="border-2 border-dashed border-border rounded-md p-3 text-center text-xs hover:border-primary/50 transition-colors">
                    <Upload className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    Загрузить фото
                  </div>
                </label>
                {image && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setImage(null);
                      onChange?.(config, undefined);
                    }}
                  >
                    Вернуть модель
                  </Button>
                )}
              </div>
            </div>

            {/* Пресеты */}
            <div>
              <Label className="text-xs">Шаблоны</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.keys(PRESETS).filter((k) => k !== "default").map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => applyPreset(preset as keyof typeof PRESETS)}
                  >
                    {preset === "chocolate" && "Шоколад"}
                    {preset === "vanilla" && "Ваниль"}
                    {preset === "red_velvet" && "Бархат"}
                    {preset === "berry" && "Ягоды"}
                    {preset === "caramel" && "Карамель"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Слои */}
            <div>
              <Label className="text-xs">Слои (сверху вниз)</Label>
              <div className="space-y-1.5 mt-1">
                {config.layers.map((layer, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(e) => updateLayer(i, { color: e.target.value })}
                      className="h-7 w-10 rounded border cursor-pointer"
                    />
                    <Input
                      value={layer.label}
                      onChange={(e) => updateLayer(i, { label: e.target.value })}
                      className="h-7 text-xs flex-1"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      value={layer.height || 1}
                      onChange={(e) => updateLayer(i, { height: parseInt(e.target.value) || 1 })}
                      className="h-7 w-12 text-xs"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-500"
                      onClick={() => removeLayer(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={addLayer}>
                <Plus className="h-3 w-3 mr-1" />
                Добавить слой
              </Button>
            </div>

            {/* Покрытие */}
            {config.coating && (
              <div>
                <Label className="text-xs">Покрытие (снаружи)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={config.coating.color}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        coating: { ...config.coating!, color: e.target.value },
                      })
                    }
                    className="h-7 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={config.coating.label}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        coating: { ...config.coating!, label: e.target.value },
                      })
                    }
                    className="h-7 text-xs flex-1"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Легенда слоёв (когда не в режиме редактирования) */}
      {!editMode && !image && (
        <div className="flex flex-wrap gap-2">
          {config.layers.map((layer, i) => (
            <Badge key={i} variant="outline" className="text-[10px] gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: layer.color }}
              />
              {layer.label}
            </Badge>
          ))}
          {config.coating && (
            <Badge variant="outline" className="text-[10px] gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: config.coating.color }}
              />
              {config.coating.label}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Компонент-галерея: все срезы продукта =====
export function ProductSliceGallery({
  productId,
  fillings,
  editable = false,
}: {
  productId: string;
  fillings: { name: string; priceModifier?: number }[];
  editable?: boolean;
}) {
  const [slices, setSlices] = useState<any[]>([]);
  const [show3DModal, setShow3DModal] = useState(false);
  const [scene3d, setScene3d] = useState<any>(null);
  const [loading3d, setLoading3d] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSlice, setSelectedSlice] = useState<any | null>(null);

  useEffect(() => {
    loadSlices();
  }, [productId]);

  const loadSlices = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/slices`);
      if (res.ok) {
        const data = await res.json();
        setSlices(data.slices || []);
      }
    } catch (err) {
      // В dev используем presets
    } finally {
      setLoading(false);
    }
  };

  // Маппим срезы к начинкам продукта
  const fillingsWithSlices = fillings.map((filling, i) => {
    const slice = slices.find((s) => s.fillingName === filling.name);
    return { ...filling, slice, index: i };
  });

  // === Загрузка 3D-сцены из среза ===
  const handleLoad3DScene = async () => {
    setLoading3d(true);
    setShow3DModal(true);
    try {
      const res = await fetch(`/api/products/${productId}/slice-3d-config`);
      if (res.ok) {
        const data = await res.json();
        setScene3d(data.scene3d);
        if (data.hasModel) {
          toast.info("У товара уже есть 3D-модель — генерация из среза не требуется");
        } else if (!data.scene3d) {
          toast.info("Недостаточно данных для 3D — добавьте описание начинки");
        } else {
          toast.success("3D-сцена сгенерирована из среза");
        }
      }
    } catch (err) {
      toast.error("Ошибка загрузки 3D-сцены");
    } finally {
      setLoading3d(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Загрузка срезов...</div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Cake className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Срезы торта по начинкам</h3>
        <Badge variant="outline" className="text-[10px]">{fillings.length}</Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={handleLoad3DScene}
          disabled={loading3d}
          className="ml-auto gap-1 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200"
        >
          {loading3d ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Boxes className="h-3.5 w-3.5 text-purple-600" />
          )}
          3D из среза
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {fillingsWithSlices.map((fw) => (
          <button
            key={fw.index}
            onClick={() => setSelectedSlice({
              name: fw.name,
              slice: fw.slice,
              priceModifier: fw.priceModifier,
            })}
            className="border rounded-lg p-2 hover:border-primary/40 transition-colors text-left"
          >
            <div className="aspect-square rounded-md bg-muted/30 flex items-center justify-center mb-2 overflow-hidden">
              {fw.slice?.image ? (
                <img
                  src={fw.slice.image}
                  alt={fw.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <SliceSVG
                  config={fw.slice?.config || detectPreset({ name: fw.name })}
                  size={120}
                />
              )}
            </div>
            <div className="text-xs font-medium truncate">{fw.name}</div>
            {fw.priceModifier !== undefined && fw.priceModifier > 0 && (
              <div className="text-[10px] text-muted-foreground">
                +{fw.priceModifier} ₽
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Modal — увеличенный срез */}
      {selectedSlice && (
        <Dialog open={!!selectedSlice} onOpenChange={(v) => !v && setSelectedSlice(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Cake className="h-5 w-5 text-primary" />
                {selectedSlice.name}
              </DialogTitle>
              {selectedSlice.priceModifier !== undefined && selectedSlice.priceModifier > 0 && (
                <DialogDescription>
                  Доплата за начинку: +{selectedSlice.priceModifier} ₽
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="flex justify-center">
              <div className="rounded-lg border bg-muted/30 p-4">
                {selectedSlice.slice?.image ? (
                  <img
                    src={selectedSlice.slice.image}
                    alt={selectedSlice.name}
                    className="rounded-md max-w-full max-h-80 object-contain"
                  />
                ) : (
                  <SliceSVG
                    config={selectedSlice.slice?.config || detectPreset({ name: selectedSlice.name })}
                    size={280}
                  />
                )}
              </div>
            </div>

            {/* Легенда слоёв */}
            <div className="flex flex-wrap gap-2 justify-center">
              {(selectedSlice.slice?.config?.layers ||
                detectPreset({ name: selectedSlice.name }).layers).map((layer: SliceLayer, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px] gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: layer.color }}
                  />
                  {layer.label}
                </Badge>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* === Modal: 3D-сцена из среза === */}
      <Dialog open={show3DModal} onOpenChange={setShow3DModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-purple-600" />
              3D-сцена из среза торта
            </DialogTitle>
            <DialogDescription>
              Динамическая 3D-модель, сгенерированная из слоёв среза.
              Каждый слой → цилиндр, покрытие → внешняя оболочка, декор → топпинги сверху.
            </DialogDescription>
          </DialogHeader>

          {loading3d ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
              <span className="ml-2 text-sm text-muted-foreground">Генерация 3D-сцены...</span>
            </div>
          ) : scene3d ? (
            <div className="space-y-3">
              {/* Превью слоёв (визуальная схема) */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4">
                <div className="text-xs font-medium text-purple-900 mb-2">
                  Структура 3D-сцены ({scene3d.meshes?.length || 0} элементов):
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {scene3d.meshes?.map((mesh: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs bg-white/60 rounded px-2 py-1"
                    >
                      <span
                        className="h-3 w-3 rounded shrink-0"
                        style={{ backgroundColor: mesh.material?.color || "#ccc" }}
                      />
                      <span className="font-mono text-[10px] text-muted-foreground w-20 shrink-0">
                        {mesh.type}
                      </span>
                      <span className="flex-1 truncate">{mesh.label || "—"}</span>
                      {mesh.layerType && (
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          {mesh.layerType}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Метаданные сцены */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-muted-foreground">Высота</div>
                  <div className="font-semibold">{(scene3d.totalHeight || 0).toFixed(2)} ед.</div>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-muted-foreground">Радиус</div>
                  <div className="font-semibold">{(scene3d.radius || 0).toFixed(2)} ед.</div>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-muted-foreground">Слоёв</div>
                  <div className="font-semibold">
                    {scene3d.meshes?.filter((m: any) => m.layerType?.includes("biscuit") || m.layerType?.includes("cream") || m.layerType?.includes("chocolate") || m.layerType?.includes("berry") || m.layerType?.includes("caramel") || m.layerType?.includes("mousse") || m.layerType?.includes("fruit") || m.layerType?.includes("nuts")).length || 0}
                  </div>
                </div>
              </div>

              {/* Источник */}
              <div className="text-xs text-muted-foreground">
                Источник: <Badge variant="outline" className="text-[10px]">{scene3d.source || "slice_config"}</Badge>
                {scene3d.fillingName && (
                  <span> · Начинка: <b>{scene3d.fillingName}</b></span>
                )}
              </div>

              {/* JSON для разработчиков */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Показать JSON-конфигурацию Three.js
                </summary>
                <pre className="mt-2 bg-muted/30 p-2 rounded text-[10px] overflow-x-auto max-h-40">
                  {JSON.stringify(scene3d, null, 2)}
                </pre>
              </details>

              <p className="text-xs text-muted-foreground">
                💡 Эта конфигурация совместима с Three.js. AR-viewer автоматически
                использует её как fallback, если у товара нет готовой GLB-модели.
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <Boxes className="h-12 w-12 mx-auto mb-2 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                Недостаточно данных для генерации 3D-сцены.
                Добавьте срез к одной из начинок.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===== Компонент-виджет для конструктора тортов =====
export function FillingSlicePreview({
  fillingName,
  size = 100,
}: {
  fillingName: string;
  size?: number;
}) {
  const config = detectPreset({ name: fillingName });
  return (
    <div
      className="rounded-md border bg-muted/20 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      <SliceSVG config={config} size={size - 8} />
    </div>
  );
}
